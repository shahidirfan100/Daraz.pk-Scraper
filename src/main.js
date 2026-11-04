import { Actor, log } from 'apify';
import { fetchCatalogPage, createProfileState, deriveSearchFallbackUrl, ProxySession } from './daraz-client.js';
import {
    normalizeUrl,
    parseCompactNumber,
    parseTraceMap,
    redactCredentials,
    sanitizeText,
    sleep,
    stripNullValues,
    toBoolean,
    toInteger,
    toNumber,
    uniqueStrings,
} from './utils.js';

const DEFAULT_SEARCH_QUERY = 'dress';
const DEFAULT_MAX_PRODUCTS = 20;
const DEFAULT_MAX_PAGES = 50;
const PROGRESS_STALL_LIMIT = 3;
const RUN_RETRY_DELAY_MS = 8000;
const RUN_RETRY_BLOCKED_DELAY_MS = 45000;
const RUN_RETRY_JITTER_MS = 4000;
const API_SOURCE = 'daraz.pk';

function parseLimit(value, fallback) {
    const parsed = Number(value);
    if (parsed === 0) return Infinity;
    if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
    return fallback;
}

function formatLimit(value) {
    return value === Infinity ? 'unlimited' : String(value);
}

function normalizeListingUrl(value) {
    const text = sanitizeText(value);
    if (!text) return null;

    try {
        const url = new URL(text, 'https://www.daraz.pk');
        if (url.protocol === 'http:') url.protocol = 'https:';
        if (url.protocol !== 'https:') return null;

        const host = url.hostname.toLowerCase();
        if (host !== 'daraz.pk' && !host.endsWith('.daraz.pk')) return null;

        if (!url.pathname || url.pathname === '/') return null;

        if (/\/products\//i.test(url.pathname) || /-i\d+\.html$/i.test(url.pathname)) {
            log.warning(`Skipping product page because it is not a listing: ${url.pathname}`);
            return null;
        }

        url.hash = '';
        url.searchParams.delete('ajax');
        url.searchParams.delete('page');

        return url.href;
    } catch {
        return null;
    }
}

function parseStartUrls(value) {
    const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [];
    const urls = [];

    for (const entry of entries) {
        const raw = typeof entry === 'string' ? entry : entry?.url;
        const normalized = normalizeListingUrl(raw);

        if (!normalized) {
            if (raw) log.warning(`Skipping invalid start URL: ${redactCredentials(raw).slice(0, 160)}`);
            continue;
        }

        urls.push(normalized);
    }

    return [...new Set(urls)];
}

function buildSearchUrl(query) {
    const url = new URL('https://www.daraz.pk/catalog/');
    url.searchParams.set('q', query);
    return url.href;
}

function resolveListings(input) {
    const startUrls = parseStartUrls(input.startUrls);
    const searchQuery = sanitizeText(input.searchQuery);

    if (startUrls.length > 0) {
        if (searchQuery) log.info('startUrls takes precedence; searchQuery is ignored for this run.');
        return { mode: 'url', listings: startUrls, query: null };
    }

    const rawStartUrls = Array.isArray(input.startUrls)
        ? input.startUrls
        : typeof input.startUrls === 'string'
          ? input.startUrls.split(/\r?\n/)
          : [];

    const suppliedUrls = rawStartUrls
        .map((entry) => sanitizeText(typeof entry === 'string' ? entry : entry?.url))
        .filter(Boolean);

    if (suppliedUrls.length > 0) {
        throw new Error(
            'None of the supplied startUrls is a valid Daraz.pk listing URL. ' +
                'Use a category URL such as https://www.daraz.pk/womens-dresses/ or leave startUrls empty to use searchQuery.',
        );
    }

    const query = searchQuery || DEFAULT_SEARCH_QUERY;
    return { mode: 'keyword', listings: [buildSearchUrl(query)], query };
}

async function createProxySession(proxyInput) {
    if (!proxyInput || typeof proxyInput !== 'object') return new ProxySession(null);

    const hasCustomProxies = Array.isArray(proxyInput.proxyUrls) && proxyInput.proxyUrls.length > 0;
    const wantsApifyProxy = proxyInput.useApifyProxy === true;

    if (!hasCustomProxies && !wantsApifyProxy) return new ProxySession(null);

    if (wantsApifyProxy && !hasCustomProxies && !Actor.isAtHome()) {
        log.warning('Apify Proxy requires the Apify platform. Continuing without a proxy.');
        return new ProxySession(null);
    }

    try {
        const configuration = await Actor.createProxyConfiguration(proxyInput);
        return new ProxySession(configuration);
    } catch (error) {
        log.warning(`Proxy configuration rejected: ${redactCredentials(error.message)}. Continuing without a proxy.`);
        return new ProxySession(null);
    }
}

function normalizeThumbnails(value) {
    if (!Array.isArray(value)) return [];

    const urls = value
        .map((entry) => normalizeUrl(typeof entry === 'string' ? entry : entry?.url || entry?.image))
        .filter(Boolean);

    return [...new Set(urls)];
}

function normalizeDescription(value) {
    if (Array.isArray(value)) {
        return value.map(sanitizeText).filter(Boolean);
    }

    const single = sanitizeText(value);
    return single ? [single] : [];
}

function normalizeProductRecord(item, context) {
    if (!item || typeof item !== 'object') return null;

    const productId = sanitizeText(item.itemId || item.nid);
    const title = sanitizeText(item.name || item.title);
    const productUrl = normalizeUrl(item.itemUrl || item.productUrl);

    if (!productId && !title && !productUrl) return null;

    const queryParams = new URLSearchParams(typeof item.querystring === 'string' ? item.querystring : '');
    const trace = parseTraceMap(item.clickTrace);
    const descriptionBullets = normalizeDescription(item.description);
    const icons = Array.isArray(item.icons) ? item.icons : [];
    const badgeTypes = uniqueStrings(icons.map((icon) => icon?.bizType || icon?.type));
    const badgeTexts = uniqueStrings(icons.map((icon) => icon?.text));
    const price = toNumber(item.price ?? item.priceShow);
    const originalPrice = toNumber(item.originalPrice ?? item.originalPriceShow);

    let discountPct = null;
    if (price !== null && originalPrice !== null && originalPrice > price) {
        discountPct = Math.round(((originalPrice - price) / originalPrice) * 100);
    } else {
        const parsedDiscount = toInteger(item.discount);
        discountPct = parsedDiscount === null ? null : Math.abs(parsedDiscount);
    }

    return {
        productId,
        skuId: sanitizeText(item.skuId),
        sku: sanitizeText(item.sku),
        title,
        description: descriptionBullets.join(' | ') || null,
        descriptionBullets,
        brand: sanitizeText(item.brandName),
        brandId: sanitizeText(item.brandId),
        sellerName: sanitizeText(item.sellerName),
        sellerId: sanitizeText(item.sellerId),
        shopId: sanitizeText(trace.shop_id),
        location: sanitizeText(item.location),
        categoryIds: Array.isArray(item.categories)
            ? item.categories.map((category) => sanitizeText(category)).filter(Boolean)
            : [],
        price,
        priceText: sanitizeText(item.priceShow),
        originalPrice,
        originalPriceText: sanitizeText(item.originalPriceShow),
        discountText: sanitizeText(item.discount),
        discountPct,
        rating: toNumber(item.ratingScore),
        reviewCount: parseCompactNumber(item.review) ?? 0,
        soldCount: parseCompactNumber(item.itemSoldCntShow) ?? parseCompactNumber(queryParams.get('sale')),
        imageUrl: normalizeUrl(item.image),
        thumbnails: normalizeThumbnails(item.thumbs),
        productUrl,
        directSimilarUrl: normalizeUrl(item.directSimilarUrl),
        inStock: toBoolean(item.inStock, true),
        isSponsored: toBoolean(item.isSponsored, false),
        promotionId: sanitizeText(item.promotionId),
        badgeTypes,
        badgeTexts,
        itemType: sanitizeText(item.tItemType),
        cheapestSku: sanitizeText(item.cheapest_sku),
        searchTerm: sanitizeText(context.searchTerm),
        page: context.page,
        sourceUrl: context.sourceUrl,
        requestId: sanitizeText(context.requestId) || sanitizeText(queryParams.get('request_id')),
        source: API_SOURCE,
        scrapedAt: context.scrapedAt,
    };
}

function normalizeBatch(items, context) {
    const products = [];
    const stats = { duplicates: 0, outOfStock: 0, invalid: 0 };

    for (const item of items) {
        let record;

        try {
            record = normalizeProductRecord(item, context);
        } catch (error) {
            stats.invalid += 1;
            log.debug(`Skipped malformed product: ${redactCredentials(error.message)}`);
            continue;
        }

        if (!record) {
            stats.invalid += 1;
            continue;
        }

        if (!context.includeOutOfStock && record.inStock === false) {
            stats.outOfStock += 1;
            continue;
        }

        const identity = record.productId || record.skuId || record.productUrl || record.title;
        if (!identity || context.seen.has(identity)) {
            stats.duplicates += 1;
            continue;
        }

        context.seen.add(identity);
        products.push(stripNullValues(record));
    }

    return { items: products, stats };
}

function createCounters() {
    return {
        saved: 0,
        pagesFetched: 0,
        failedPages: 0,
        duplicates: 0,
        outOfStock: 0,
        invalid: 0,
        fallbacks: 0,
        temporaryFailures: 0,
        lastError: null,
    };
}

async function processListing(listing, context) {
    const { maxPages, maxProducts, includeOutOfStock, seen, state, proxySession, counters, usedProfiles } = context;

    let sourceUrl = listing;
    let usedSearchRoute = false;
    let page = 1;
    let pageSize = null;
    let stalledPages = 0;
    let stopReason = 'completed';
    let savedForListing = 0;
    const pagesBefore = counters.pagesFetched;
    const fetchBudget = Number.isFinite(maxPages) ? Math.max(maxPages * 2, 2) : 500;

    log.info(`Listing started: ${listing}`);

    while (page <= maxPages && counters.saved < maxProducts) {
        if (counters.pagesFetched - pagesBefore >= fetchBudget) {
            stopReason = 'page-budget';
            log.warning('Listing reached its request budget; stopping it', { source: sourceUrl, page });
            break;
        }

        let result;

        try {
            result = await fetchCatalogPage({ sourceUrl, page, state, proxySession });
        } catch (error) {
            counters.failedPages += 1;
            counters.lastError = error;
            if (error.temporary) counters.temporaryFailures += 1;

            if (!usedSearchRoute && savedForListing === 0 && error.code === 'listing-not-found') {
                const fallback = deriveSearchFallbackUrl(listing);

                if (fallback) {
                    usedSearchRoute = true;
                    counters.fallbacks += 1;
                    sourceUrl = fallback;
                    page = 1;
                    pageSize = null;
                    stalledPages = 0;
                    log.warning(`Listing route is unavailable. Retrying as a keyword search: ${fallback}`);
                    continue;
                }
            }

            stopReason = error.code === 'listing-not-found' ? 'listing-not-found' : 'request-failed';
            log.warning(`Listing stopped at page ${page}: ${error.message}`, {
                source: sourceUrl,
                code: error.code,
                status: error.status,
                marker: error.marker,
                temporary: error.temporary,
            });
            break;
        }

        counters.pagesFetched += 1;
        usedProfiles.add(result.profile);

        if (result.itemPath !== 'mods.listItems') {
            log.warning('Catalog item array moved', {
                path: result.itemPath,
                topKeys: result.payloadKeys,
                hint: 'Update locateListItems() in src/daraz-client.js',
            });
        }

        const responsePageSize = result.meta.pageSize || (result.items.length > 0 ? result.items.length : null);

        if (pageSize && responsePageSize && responsePageSize !== pageSize) {
            const translatedPage = Math.floor(((page - 1) * pageSize) / responsePageSize) + 1;
            log.info('Page size changed; continuing from a translated page', {
                from: pageSize,
                to: responsePageSize,
                previousPage: page,
                nextPage: translatedPage,
            });
            pageSize = responsePageSize;
            page = translatedPage;
            continue;
        }

        if (responsePageSize) pageSize = responsePageSize;

        const batch = normalizeBatch(result.items, {
            page: result.meta.page || page,
            requestId: result.meta.requestId,
            searchTerm: result.meta.title,
            sourceUrl,
            includeOutOfStock,
            seen,
            scrapedAt: new Date().toISOString(),
        });

        counters.duplicates += batch.stats.duplicates;
        counters.outOfStock += batch.stats.outOfStock;
        counters.invalid += batch.stats.invalid;

        const newUnique = result.items.length - batch.stats.duplicates - batch.stats.invalid;

        if (batch.items.length > 0) {
            const remaining = maxProducts === Infinity ? batch.items.length : Math.max(0, maxProducts - counters.saved);
            const selected = batch.items.slice(0, remaining);

            if (selected.length > 0) {
                await Actor.pushData(selected);
                counters.saved += selected.length;
                savedForListing += selected.length;
                log.info('Batch saved', {
                    saved: selected.length,
                    total: counters.saved,
                    target: formatLimit(maxProducts),
                    page: result.meta.page || page,
                    profile: result.profile,
                });
            }
        }

        if (counters.saved >= maxProducts) {
            stopReason = 'product-limit';
            break;
        }
        if (result.meta.noMorePages) {
            stopReason = 'no-more-pages';
            break;
        }
        if (result.meta.totalPages && page >= result.meta.totalPages) {
            stopReason = 'last-page';
            break;
        }
        if (pageSize && result.items.length < pageSize) {
            stopReason = 'short-page';
            break;
        }

        // Category URLs are served by an edge cache that sometimes ignores the
        // page parameter and replays the same items. The catalog search route
        // paginates correctly, so switch to it instead of losing the rest of
        // the requested products.
        if (newUnique === 0 && !usedSearchRoute) {
            const searchUrl = deriveSearchFallbackUrl(sourceUrl);

            if (searchUrl) {
                usedSearchRoute = true;
                counters.fallbacks += 1;
                sourceUrl = searchUrl;
                page = 1;
                pageSize = null;
                stalledPages = 0;
                log.warning(`Category pagination repeated; continuing as a keyword search: ${searchUrl}`);
                continue;
            }
        }

        stalledPages = newUnique > 0 ? 0 : stalledPages + 1;
        if (stalledPages >= PROGRESS_STALL_LIMIT) {
            stopReason = 'repeated-pages';
            log.warning('The listing returned the same products on consecutive pages; stopping this listing', {
                source: sourceUrl,
                page,
            });
            break;
        }

        page += 1;
    }

    log.info('Listing finished', {
        listing,
        saved: savedForListing,
        pagesFetched: counters.pagesFetched - pagesBefore,
        stopReason,
    });
}

async function runExtraction({
    listings,
    query,
    mode,
    maxProducts,
    maxPages,
    includeOutOfStock,
    proxySession,
    attempt,
}) {
    const state = createProfileState();
    const seen = new Set();
    const counters = createCounters();
    const usedProfiles = new Set();

    log.info(attempt === 1 ? 'Run started' : 'Run retry started', {
        mode,
        listings: listings.length,
        query: query || undefined,
        maxProducts: formatLimit(maxProducts),
        maxPages: formatLimit(maxPages),
        proxy: proxySession.enabled,
    });

    for (const listing of listings) {
        if (counters.saved >= maxProducts) break;
        await processListing(listing, {
            maxPages,
            maxProducts,
            includeOutOfStock,
            seen,
            state,
            proxySession,
            counters,
            usedProfiles,
        });
    }

    return { counters, usedProfiles };
}

function describeFailure(error) {
    if (!error) return 'No products were extracted and the reason could not be determined.';

    if (error.code === 'challenge') {
        return (
            'Daraz served its anti-bot challenge page (punish/x5sec). The current IP is rate-limited. ' +
            'Enable Apify Proxy, preferably residential sessions in Pakistan, then run again.'
        );
    }

    if (error.code === 'listing-not-found') {
        return (
            `No products were extracted because ${error.sourceUrl || 'the start URL'} is not a valid Daraz listing. ` +
            'Use a category URL such as https://www.daraz.pk/womens-dresses/ or a search query instead.'
        );
    }

    return (
        `No products were extracted after retries (${error.code || error.marker || 'unknown'}: ${error.message}). ` +
        `Last request: ${error.sourceUrl || 'unknown'}.`
    );
}

async function main() {
    const input = (await Actor.getInput()) || {};
    const includeOutOfStock = toBoolean(input.includeOutOfStock, false);
    const maxProducts = parseLimit(input.maxProducts, DEFAULT_MAX_PRODUCTS);
    const maxPages = parseLimit(input.maxPages, DEFAULT_MAX_PAGES);
    const proxySession = await createProxySession(input.proxyConfiguration);
    const { mode, listings, query } = resolveListings(input);
    const options = { listings, query, mode, maxProducts, maxPages, includeOutOfStock, proxySession };

    let { counters, usedProfiles } = await runExtraction({ ...options, attempt: 1 });

    if (counters.saved === 0 && counters.temporaryFailures > 0) {
        const blocked = counters.lastError?.code === 'challenge';
        const delay = blocked ? RUN_RETRY_BLOCKED_DELAY_MS : RUN_RETRY_DELAY_MS;

        log.warning(
            blocked
                ? 'Daraz returned its anti-bot challenge on the first pass. Cooling down, then retrying once.'
                : 'No products were saved on the first pass. Retrying the whole run once after a short pause.',
        );

        if (proxySession.enabled) await proxySession.rotate();
        await sleep(delay + Math.floor(Math.random() * RUN_RETRY_JITTER_MS));

        ({ counters, usedProfiles } = await runExtraction({ ...options, attempt: 2 }));
    }

    if (counters.saved === 0 && counters.failedPages > 0) {
        throw new Error(describeFailure(counters.lastError));
    }

    log.info('Run finished', {
        saved: counters.saved,
        pages: counters.pagesFetched,
        duplicates: counters.duplicates,
        outOfStock: counters.outOfStock,
        invalid: counters.invalid,
        failedPages: counters.failedPages,
        fallbacks: counters.fallbacks,
        profiles: [...usedProfiles].join(','),
        proxyRotations: proxySession.rotations,
    });

    if (counters.saved === 0) {
        log.warning('The selected search returned zero products. The dataset is empty.');
    }
}

await Actor.init();

let exitCode = 0;

try {
    await main();
} catch (error) {
    exitCode = 1;
    log.exception(error, 'Actor failed');
}

await Actor.exit({ exitCode });
