import { log } from 'apify';
import { Impit } from 'impit';
import { redactCredentials, sleep, toNumber, toBoolean } from './utils.js';

const REQUEST_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS_PER_PAGE = 8;
const MAX_CHALLENGE_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 45000;
const CHALLENGE_WAITS_MS = Object.freeze([10000, 25000]);
const RETRY_BASE_MS = 700;
const RETRY_MAX_MS = 8000;
const RETRY_JITTER_MS = 400;

// Profiles verified against the catalog endpoint. See API_DISCOVERY.md.
// ios18 is first because the mobile listing returns 80 products per page.
export const PROFILE_POOL = Object.freeze([
    'ios18',
    'chrome151',
    'chrome142',
    'chrome136',
    'firefox158',
    'firefox144',
    'okhttp5',
    'okhttp4',
]);

const HEADER_STRATEGIES = Object.freeze(['profile', 'ajax']);

/**
 * Daraz serves this route for listing paths that do not exist (for example a
 * category slug that was typed by hand). Retrying it never helps, so it is
 * classified separately from a challenge page.
 */
const ERROR_ROUTE_PATTERN = /\/lazada\/channel\/[^"'\s]*?common\/error/i;

const NON_LISTING_SEGMENTS = new Set(['catalog', 'search', 'products', 'product', 'index', 'home', 'pk']);

const KNOWN_ITEM_PATHS = Object.freeze([
    { path: 'mods.listItems', read: (payload) => payload?.mods?.listItems, allowEmpty: true },
    { path: 'mods.itemList', read: (payload) => payload?.mods?.itemList },
    { path: 'mods.items', read: (payload) => payload?.mods?.items },
    { path: 'mods.productList', read: (payload) => payload?.mods?.productList },
    { path: 'data.listItems', read: (payload) => payload?.data?.listItems },
    { path: 'data.items', read: (payload) => payload?.data?.items },
    { path: 'result.items', read: (payload) => payload?.result?.items },
    { path: 'items', read: (payload) => payload?.items },
]);

const clients = new Map();

export class CatalogRequestError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'CatalogRequestError';
        this.temporary = options.temporary ?? true;
        this.status = options.status ?? null;
        this.retryAfterMs = options.retryAfterMs ?? null;
        this.marker = options.marker ?? 'unknown';
        this.code = options.code ?? null;
        this.details = options.details ?? null;
    }
}

export class ProxySession {
    constructor(proxyConfiguration) {
        this.configuration = proxyConfiguration || null;
        this.url = null;
        this.rotations = 0;
    }

    get enabled() {
        return Boolean(this.configuration);
    }

    async get() {
        if (!this.enabled) return undefined;
        if (!this.url) this.url = await this.configuration.newUrl();
        return this.url;
    }

    async rotate() {
        if (!this.enabled) return;

        try {
            this.url = await this.configuration.newUrl();
            this.rotations += 1;
            clients.clear();
        } catch (error) {
            log.warning(`Proxy session rotation failed: ${redactCredentials(error.message)}`);
        }
    }

    /**
     * Drops a proxy that cannot even create a client (invalid URL, unsupported
     * protocol). A broken proxy must not turn the whole run into a failure.
     */
    async disable(reason) {
        if (!this.enabled) return;

        this.configuration = null;
        this.url = null;
        clients.clear();
        log.warning(
            `Proxy disabled for the rest of this run: ${redactCredentials(reason)}. Continuing without a proxy.`,
        );
    }
}

export function createProfileState() {
    return {
        profiles: [...PROFILE_POOL],
        active: null,
        failures: new Map(),
        strategyIndex: 0,
    };
}

export function buildPageUrl(sourceUrl, page) {
    const url = new URL(sourceUrl);
    url.searchParams.delete('page');
    url.searchParams.set('ajax', 'true');
    url.searchParams.set('page', String(page));
    return url;
}

/**
 * Turns a category path such as /mobiles/ into the documented catalog search
 * form. Used only when the path itself returns the Daraz error route.
 */
export function deriveSearchFallbackUrl(sourceUrl) {
    let url;
    try {
        url = new URL(sourceUrl);
    } catch {
        return null;
    }

    if (url.searchParams.get('q')) return null;

    const segments = url.pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (!lastSegment) return null;

    let decoded = lastSegment;
    try {
        decoded = decodeURIComponent(lastSegment);
    } catch {
        decoded = lastSegment;
    }

    const term = decoded
        .replace(/\.(html?|php)$/i, '')
        .replace(/[-_+]+/g, ' ')
        .trim();

    if (!term || NON_LISTING_SEGMENTS.has(term.toLowerCase())) return null;

    const fallback = new URL('https://www.daraz.pk/catalog/');
    fallback.searchParams.set('q', term);
    return fallback.href;
}

function getClient(profile, proxyUrl) {
    const key = `${profile}|${proxyUrl || 'direct'}`;
    if (!clients.has(key)) {
        clients.set(
            key,
            new Impit({
                browser: profile,
                timeout: REQUEST_TIMEOUT_MS,
                ...(proxyUrl ? { proxyUrl } : {}),
            }),
        );
    }

    return clients.get(key);
}

function buildHeaders(strategy, sourceUrl) {
    if (strategy === 'ajax') {
        return {
            accept: 'application/json, text/plain, */*',
            'x-requested-with': 'XMLHttpRequest',
            referer: sourceUrl,
        };
    }

    return {};
}

function parseRetryAfter(headers) {
    const raw = headers?.get?.('retry-after');
    if (!raw) return null;

    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

    const timestamp = Date.parse(raw);
    if (Number.isFinite(timestamp)) return Math.max(0, timestamp - Date.now());

    return null;
}

function resolveRetryDelay(attempt, retryAfterMs) {
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        return Math.min(retryAfterMs, RETRY_MAX_MS);
    }

    const base = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
    return base + Math.floor(Math.random() * RETRY_JITTER_MS);
}

function pickProfile(state, excluded) {
    const available = state.profiles.filter((profile) => !excluded.has(profile));
    if (available.length === 0) return null;

    if (state.active && available.includes(state.active) && !state.failures.get(state.active)) {
        return state.active;
    }

    return available.sort((left, right) => {
        const failureDelta = (state.failures.get(left) || 0) - (state.failures.get(right) || 0);
        if (failureDelta !== 0) return failureDelta;
        return state.profiles.indexOf(left) - state.profiles.indexOf(right);
    })[0];
}

export function detectResponseMarker(text, contentType = '') {
    const trimmed = (text || '').trimStart();
    if (!trimmed) return 'empty';

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
    if (/^[a-zA-Z_$][\w$]*\s*\(/.test(trimmed.slice(0, 200))) return 'jsonp';

    const head = trimmed.slice(0, 8000);
    if (ERROR_ROUTE_PATTERN.test(head)) return 'not-found';
    if (/_____tmd_____\/punish|x5secdata/i.test(head)) return 'punish';
    if (/captcha|access denied|pardon our interruption|verify you are human|robot check/i.test(head)) {
        return 'blocked';
    }
    if (/<(!doctype|html|head|body)/i.test(trimmed.slice(0, 500))) return 'html';
    if (contentType.includes('json')) return 'json-invalid';

    return 'other';
}

function parseJsonp(text) {
    const match = text.match(/^\s*[a-zA-Z_$][\w$]*\s*\(\s*([\s\S]*)\s*\)\s*;?\s*$/);
    if (!match) return null;

    try {
        return JSON.parse(match[1]);
    } catch {
        return null;
    }
}

function extractBalancedJson(text, openIndex) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = openIndex; index < text.length; index += 1) {
        const character = text[index];

        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
            continue;
        }

        if (character === '"') {
            inString = true;
        } else if (character === '{') {
            depth += 1;
        } else if (character === '}') {
            depth -= 1;

            if (depth === 0) {
                try {
                    return JSON.parse(text.slice(openIndex, index + 1));
                } catch {
                    return null;
                }
            }
        }
    }

    return null;
}

function extractEmbeddedPayload(text) {
    const nextData = text.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nextData) {
        try {
            return JSON.parse(nextData[1]);
        } catch {
            return null;
        }
    }

    for (const globalName of ['window.pageData', 'window.__INITIAL_STATE__', 'window.__PRELOADED_STATE__']) {
        const startIndex = text.indexOf(`${globalName} =`);
        if (startIndex === -1) continue;

        const braceIndex = text.indexOf('{', startIndex);
        if (braceIndex === -1) continue;

        const parsed = extractBalancedJson(text, braceIndex);
        if (parsed) return parsed;
    }

    return null;
}

function looksLikeProduct(item) {
    if (!item || typeof item !== 'object') return false;

    const hasIdentity = Boolean(item.itemId || item.nid || item.skuId);
    const hasName = Boolean(item.name || item.title);
    const hasPrice = 'price' in item || 'priceShow' in item;

    return hasIdentity && hasName && hasPrice;
}

function findProductArray(node, path = '', depth = 0) {
    if (depth > 5 || !node || typeof node !== 'object') return null;

    if (Array.isArray(node)) {
        if (node.length > 0 && looksLikeProduct(node[0])) return { items: node, path };
        return null;
    }

    for (const [key, value] of Object.entries(node)) {
        const childPath = path ? `${path}.${key}` : key;
        const found = findProductArray(value, childPath, depth + 1);
        if (found) return found;
    }

    return null;
}

function locateListItems(payload) {
    for (const candidate of KNOWN_ITEM_PATHS) {
        const value = candidate.read(payload);
        if (!Array.isArray(value)) continue;

        if (value.length === 0) {
            if (candidate.allowEmpty) return { items: value, path: candidate.path };
            continue;
        }

        if (looksLikeProduct(value[0])) return { items: value, path: candidate.path };
    }

    return findProductArray(payload);
}

function readMeta(payload, items) {
    const mainInfo = payload?.mainInfo || payload?.data?.mainInfo || payload?.pageInfo || {};
    const pageSize = toNumber(mainInfo.pageSize) || (items.length > 0 ? items.length : null);
    const totalResults = toNumber(mainInfo.totalResults);
    const totalPages = totalResults !== null && pageSize ? Math.ceil(totalResults / pageSize) : null;

    return {
        page: toNumber(mainInfo.page) || 1,
        pageSize,
        totalResults,
        totalPages,
        noMorePages: toBoolean(mainInfo.noMorePages, false),
        requestId: mainInfo.RN || null,
        title: mainInfo.title || null,
        pageType: mainInfo.pageType || null,
        query: mainInfo.q || null,
    };
}

export function parseCatalogPayload(text, contentType = '') {
    const marker = detectResponseMarker(text, contentType);
    let payload = null;

    if (marker === 'json') {
        try {
            payload = JSON.parse(text);
        } catch {
            payload = null;
        }
    } else if (marker === 'jsonp') {
        payload = parseJsonp(text);
    }

    if (!payload) payload = extractEmbeddedPayload(text);
    if (!payload || typeof payload !== 'object') return null;

    const located = locateListItems(payload);
    if (!located) return null;

    return {
        items: located.items,
        itemPath: located.path,
        meta: readMeta(payload, located.items),
        payloadKeys: Object.keys(payload).slice(0, 10),
    };
}

function summarizeResponse(text, marker) {
    const summary = { marker, bytes: text.length };

    try {
        const payload = JSON.parse(text);
        summary.topKeys = Object.keys(payload).slice(0, 10);

        if (payload?.mods && typeof payload.mods === 'object') {
            summary.modKeys = Object.keys(payload.mods).slice(0, 12);
        }
        if (payload?.mainInfo) {
            summary.page = payload.mainInfo.page;
            summary.totalResults = payload.mainInfo.totalResults;
        }
    } catch {
        // Non-JSON responses keep the marker and byte count only.
    }

    return summary;
}

function describeMarker(marker) {
    if (marker === 'not-found') return 'Daraz returned its generic error route for this listing';
    if (marker === 'punish') return 'Daraz anti-bot challenge (punish/x5sec)';
    if (marker === 'blocked') return 'Daraz anti-bot challenge (captcha)';

    return 'Unrecognized catalog response';
}

function classifyFailure(marker) {
    if (marker === 'not-found') {
        return { code: 'listing-not-found', temporary: false };
    }
    if (marker === 'blocked' || marker === 'punish') {
        return { code: 'challenge', temporary: true };
    }

    return { code: 'unrecognized-response', temporary: true };
}

export async function fetchCatalogPage({ sourceUrl, page, state, proxySession }) {
    const requestUrl = buildPageUrl(sourceUrl, page);
    const safeUrl = redactCredentials(requestUrl.href).slice(0, 180);
    const excluded = new Set();
    let lastError = null;
    let waitMs = 0;
    let challengeCount = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAGE; attempt += 1) {
        const profile = pickProfile(state, excluded);
        if (!profile) break;

        const strategyIndex = (state.strategyIndex + attempt - 1) % HEADER_STRATEGIES.length;
        const strategy = HEADER_STRATEGIES[strategyIndex];
        const startedAt = Date.now();
        let client;

        try {
            const proxyUrl = await proxySession.get();
            client = getClient(profile, proxyUrl);
        } catch (error) {
            lastError = new CatalogRequestError(`Request client setup failed: ${redactCredentials(error.message)}`, {
                temporary: true,
                code: 'client-init',
                marker: 'client',
            });
            state.failures.set(profile, (state.failures.get(profile) || 0) + 1);
            excluded.add(profile);
            log.warning('Request client could not be created', {
                profile,
                message: redactCredentials(error.message),
            });
            await proxySession.disable(error.message);
            continue;
        }

        try {
            const response = await client.fetch(requestUrl.href, {
                headers: buildHeaders(strategy, sourceUrl),
            });
            const { status } = response;

            if (status >= 400) {
                const temporary = [401, 403, 407, 408, 425, 429].includes(status) || status >= 500;
                throw new CatalogRequestError(`HTTP ${status}`, {
                    temporary,
                    status,
                    retryAfterMs: parseRetryAfter(response.headers),
                    marker: status >= 500 ? 'server-error' : 'blocked',
                    code: `http-${status}`,
                });
            }

            const contentType = response.headers.get('content-type') || '';
            const text = await response.text();
            const parsed = parseCatalogPayload(text, contentType);

            if (!parsed) {
                const marker = detectResponseMarker(text, contentType);
                const failure = classifyFailure(marker);
                throw new CatalogRequestError(describeMarker(marker), {
                    status,
                    marker,
                    temporary: failure.temporary,
                    code: failure.code,
                    details: summarizeResponse(text, marker),
                });
            }

            const totalResults = Number(parsed.meta.totalResults);

            if (
                parsed.items.length === 0 &&
                !parsed.meta.noMorePages &&
                Number.isFinite(totalResults) &&
                totalResults > 0
            ) {
                throw new CatalogRequestError('Empty item array with a non-zero total', {
                    status,
                    marker: 'empty-with-total',
                    code: 'empty-with-total',
                    details: {
                        page: parsed.meta.page,
                        totalResults,
                    },
                });
            }

            // A real empty result carries totalResults "0" and noMorePages true.
            // An empty array without page metadata is an error envelope, not data.
            if (parsed.items.length === 0 && !parsed.meta.noMorePages && parsed.meta.totalResults === null) {
                throw new CatalogRequestError('Empty catalog payload without page metadata', {
                    status,
                    marker: 'empty-unexpected',
                    code: 'empty-unexpected',
                    details: {
                        page: parsed.meta.page,
                        topKeys: parsed.payloadKeys,
                    },
                });
            }

            state.failures.delete(profile);
            state.active = profile;
            state.strategyIndex = strategyIndex;

            return {
                ...parsed,
                profile,
                strategy,
                attempt,
                status,
                sourceUrl,
                durationMs: Date.now() - startedAt,
            };
        } catch (error) {
            const normalized =
                error instanceof CatalogRequestError
                    ? error
                    : new CatalogRequestError(
                          `${error.constructor?.name || 'Error'}: ${redactCredentials(error.message)}`,
                          {
                              temporary: true,
                              marker: 'network',
                              code: 'network',
                          },
                      );

            normalized.sourceUrl = safeUrl;
            lastError = normalized;
            state.failures.set(profile, (state.failures.get(profile) || 0) + 1);
            if (state.active === profile) state.active = null;
            excluded.add(profile);

            log.warning(`Page ${page} attempt ${attempt} failed`, {
                profile,
                strategy,
                status: normalized.status,
                marker: normalized.marker,
                code: normalized.code,
                url: safeUrl,
                durationMs: Date.now() - startedAt,
                message: redactCredentials(normalized.message),
                ...(normalized.details || {}),
            });

            if (!normalized.temporary) throw normalized;

            const challenged =
                normalized.marker === 'punish' || (normalized.marker === 'blocked' && normalized.status === 200);
            if (challenged) challengeCount += 1;

            const rotatingStatus =
                [401, 403, 407, 408, 425, 429].includes(normalized.status) || normalized.status >= 500;

            if ((rotatingStatus || challenged || normalized.marker === 'network') && proxySession.enabled) {
                await proxySession.rotate();
            }

            // Retrying an anti-bot challenge in a tight loop only extends the block.
            // Give it two spaced-out chances, then let the run-level retry decide.
            if (challenged && challengeCount >= MAX_CHALLENGE_ATTEMPTS) break;

            if (attempt < MAX_ATTEMPTS_PER_PAGE) {
                const delay = challenged
                    ? CHALLENGE_WAITS_MS[Math.min(challengeCount - 1, CHALLENGE_WAITS_MS.length - 1)]
                    : resolveRetryDelay(attempt, normalized.retryAfterMs);

                if (waitMs + delay > MAX_RETRY_WAIT_MS) break;

                waitMs += delay;
                await sleep(delay);
            }
        }
    }

    throw (
        lastError ||
        new CatalogRequestError('No browser profile left to try', {
            temporary: false,
            code: 'profiles-exhausted',
        })
    );
}
