import { log } from 'apify';
import { Impit } from 'impit';
import { redactCredentials, sleep, toNumber, toBoolean } from './utils.js';

const REQUEST_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS_PER_PAGE = 4;
const RETRY_BASE_MS = 400;
const RETRY_MAX_MS = 8000;
const RETRY_JITTER_MS = 250;

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
}

export function createProfileState() {
    return {
        profiles: [...PROFILE_POOL],
        active: PROFILE_POOL[0],
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

    const activeFailures = state.failures.get(state.active) || 0;
    if (available.includes(state.active) && activeFailures === 0) return state.active;

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

export async function fetchCatalogPage({ sourceUrl, page, state, proxySession }) {
    const excluded = new Set();
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAGE; attempt += 1) {
        const profile = pickProfile(state, excluded);
        if (!profile) break;

        const strategyIndex = (state.strategyIndex + attempt - 1) % HEADER_STRATEGIES.length;
        const strategy = HEADER_STRATEGIES[strategyIndex];
        const proxyUrl = await proxySession.get();
        const client = getClient(profile, proxyUrl);
        const requestUrl = buildPageUrl(sourceUrl, page);
        const startedAt = Date.now();

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
                });
            }

            const contentType = response.headers.get('content-type') || '';
            const text = await response.text();
            const parsed = parseCatalogPayload(text, contentType);

            if (!parsed) {
                const marker = detectResponseMarker(text, contentType);
                throw new CatalogRequestError('Unrecognized catalog response', {
                    status,
                    marker,
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
                    details: {
                        page: parsed.meta.page,
                        totalResults,
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
                          },
                      );

            lastError = normalized;
            state.failures.set(profile, (state.failures.get(profile) || 0) + 1);
            if (state.active === profile) state.active = null;
            excluded.add(profile);

            log.warning(`Page ${page} attempt ${attempt} failed`, {
                profile,
                strategy,
                status: normalized.status,
                marker: normalized.marker,
                durationMs: Date.now() - startedAt,
                message: redactCredentials(normalized.message),
                ...(normalized.details || {}),
            });

            if (!normalized.temporary) throw normalized;

            if ([403, 407, 429].includes(normalized.status) && proxySession.enabled) {
                await proxySession.rotate();
            }

            if (attempt < MAX_ATTEMPTS_PER_PAGE) {
                await sleep(resolveRetryDelay(attempt, normalized.retryAfterMs));
            }
        }
    }

    throw lastError || new CatalogRequestError('No browser profile left to try', { temporary: false });
}
