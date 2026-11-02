import { Actor, log } from 'apify';
import { fetchCatalogPage, createProfileState, ProxySession } from './daraz-client.js';
import {
    normalizeUrl,
    parseCompactNumber,
    parseTraceMap,
    redactCredentials,
    sanitizeText,
    stripNullValues,
    toBoolean,
    toInteger,
    toNumber,
    uniqueStrings,
} from './utils.js';

const DEFAULT_SEARCH_QUERY = 'dress';
const DEFAULT_MAX_PRODUCTS = 20;
const DEFAULT_MAX_PAGES = 50;
const MAX_PAGE_SIZE_RESTARTS = 1;
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
        const record = normalizeProductRecord(item, context);

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

async function main() {
    const input = (await Actor.getInput()) || {};
    const includeOutOfStock = toBoolean(input.includeOutOfStock, false);
    const maxProducts = parseLimit(input.maxProducts, DEFAULT_MAX_PRODUCTS);
    const maxPages = parseLimit(input.maxPages, DEFAULT_MAX_PAGES);
    const proxySession = await createProxySession(input.proxyConfiguration);
    const { mode, listings, query } = resolveListings(input);
    const state = createProfileState();
    const seen = new Set();

    log.info('Run started', {
        mode,
        listings: listings.length,
        query: query || undefined,
        maxProducts: formatLimit(maxProducts),
        maxPages: formatLimit(maxPages),
        proxy: proxySession.enabled,
    });

    let savedCount = 0;
    let pagesFetched = 0;
    let failedPages = 0;
    let duplicates = 0;
    let outOfStock = 0;
    let invalid = 0;
    const usedProfiles = new Set();

    for (const listing of listings) {
        if (savedCount >= maxProducts) break;

        log.info(`Listing started: ${listing}`);

        let page = 1;
        let pageSize = null;
        let restarts = 0;
        let stopReason = 'completed';

        while (page <= maxPages && savedCount < maxProducts) {
            let result;

            try {
                result = await fetchCatalogPage({ sourceUrl: listing, page, state, proxySession });
            } catch (error) {
                failedPages += 1;
                stopReason = 'request-failed';
                log.warning(`Listing stopped at page ${page}: ${error.message}`, {
                    temporary: error.temporary,
                    status: error.status,
                    marker: error.marker,
                    hint: 'See API_DISCOVERY.md',
                });
                break;
            }

            pagesFetched += 1;
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
                if (restarts >= MAX_PAGE_SIZE_RESTARTS) {
                    stopReason = 'page-size-changed';
                    log.warning('Page size changed again; stopping this listing', {
                        from: pageSize,
                        to: responsePageSize,
                    });
                    break;
                }

                restarts += 1;
                log.info('Page size changed; restarting listing to keep offsets aligned', {
                    from: pageSize,
                    to: responsePageSize,
                });
                pageSize = responsePageSize;
                page = 1;
                continue;
            }

            if (responsePageSize) pageSize = responsePageSize;

            const batch = normalizeBatch(result.items, {
                page: result.meta.page || page,
                requestId: result.meta.requestId,
                searchTerm: result.meta.title,
                sourceUrl: listing,
                includeOutOfStock,
                seen,
                scrapedAt: new Date().toISOString(),
            });

            duplicates += batch.stats.duplicates;
            outOfStock += batch.stats.outOfStock;
            invalid += batch.stats.invalid;

            if (batch.items.length > 0) {
                const remaining = maxProducts === Infinity ? batch.items.length : Math.max(0, maxProducts - savedCount);
                const selected = batch.items.slice(0, remaining);

                if (selected.length > 0) {
                    await Actor.pushData(selected);
                    savedCount += selected.length;
                    log.info('Batch saved', {
                        saved: selected.length,
                        total: savedCount,
                        target: formatLimit(maxProducts),
                        page: result.meta.page || page,
                        profile: result.profile,
                    });
                }
            }

            if (savedCount >= maxProducts) {
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

            page += 1;
        }

        log.info('Listing finished', { saved: savedCount, pagesFetched, stopReason });
    }

    if (savedCount === 0) {
        if (failedPages > 0) {
            throw new Error(
                `No products were extracted. ${failedPages} page request(s) failed. ` +
                    'Read API_DISCOVERY.md, then check the response marker in the logs.',
            );
        }

        log.warning('The selected search returned zero products. The dataset is empty.');
        return;
    }

    log.info('Run finished', {
        saved: savedCount,
        pages: pagesFetched,
        duplicates,
        outOfStock,
        invalid,
        failedPages,
        profiles: [...usedProfiles].join(','),
        proxyRotations: proxySession.rotations,
    });
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
