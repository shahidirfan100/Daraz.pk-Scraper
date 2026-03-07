import { readFile } from 'node:fs/promises';
import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';

const DEFAULT_START_URL = 'https://www.daraz.pk/womens-fashion/';
const DEFAULT_MAX_PRODUCTS = 20;
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_PAGE_SIZE = 40;
const INTERNAL_SORT_BY = 'popularity';
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
];

await Actor.init();

function pickUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sanitizeText(value) {
    if (value === null || value === undefined) return null;

    const normalized = String(value)
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();

    return normalized || null;
}

function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;

    const normalized = String(value)
        .replace(/[\s,]/g, '')
        .replace(/[^0-9.-]/g, '');

    if (!normalized) return null;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function extractInteger(value) {
    if (!value) return null;

    const match = String(value).match(/\d+/);
    return match ? Number(match[0]) : null;
}

function parsePositiveLimit(value, fallback) {
    const parsed = Number(value);

    if (parsed === 0) return Infinity;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;

    return fallback;
}

function parseStartUrls(value) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => sanitizeText(entry))
            .filter(Boolean);
    }

    // Backward compatibility for old multiline string input.
    if (typeof value === 'string') {
        return value
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    return [];
}

function hasInputValues(value) {
    return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
}

async function readJsonFile(filePath) {
    try {
        const content = await readFile(filePath, 'utf8');
        return JSON.parse(content);
    } catch {
        return null;
    }
}

async function loadActorInput() {
    const runtimeInput = (await Actor.getInput()) || {};
    if (hasInputValues(runtimeInput)) return runtimeInput;

    const localInput = await readJsonFile('INPUT.json')
        || await readJsonFile('storage/key_value_stores/default/INPUT.json');

    if (hasInputValues(localInput)) {
        log.info('No runtime input provided. Using INPUT.json defaults.');
        return localInput;
    }

    log.info('No runtime input provided. Using internal defaults.');
    return {};
}

function normalizeAbsoluteUrl(url) {
    if (!url) return null;

    const text = String(url).trim();
    if (!text) return null;

    if (text.startsWith('//')) return `https:${text}`;
    if (text.startsWith('/')) return new URL(text, 'https://www.daraz.pk').href;
    if (/^https?:\/\//i.test(text)) return text;

    return new URL(text, 'https://www.daraz.pk').href;
}

function parseTraceMap(value) {
    if (!value) return {};

    return String(value)
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .reduce((accumulator, entry) => {
            const separatorIndex = entry.indexOf(':');
            if (separatorIndex === -1) return accumulator;

            const key = entry.slice(0, separatorIndex).trim();
            const rawValue = entry.slice(separatorIndex + 1).trim();

            if (key) accumulator[key] = rawValue;
            return accumulator;
        }, {});
}

function stripNullValues(value) {
    if (value === null || value === undefined) return undefined;

    if (Array.isArray(value)) {
        return value
            .map(stripNullValues)
            .filter((item) => item !== undefined);
    }

    if (typeof value === 'object') {
        const cleaned = {};

        for (const [key, nestedValue] of Object.entries(value)) {
            const normalized = stripNullValues(nestedValue);
            if (normalized !== undefined) cleaned[key] = normalized;
        }

        return cleaned;
    }

    return value;
}

function buildSearchUrl({ searchQuery }) {
    const searchUrl = new URL('https://www.daraz.pk/catalog/');
    searchUrl.searchParams.set('q', searchQuery.trim());
    searchUrl.searchParams.set('sort', INTERNAL_SORT_BY);

    return searchUrl.href;
}

function decorateListingUrl(url) {
    const listingUrl = new URL(url);
    listingUrl.searchParams.set('sort', INTERNAL_SORT_BY);

    return listingUrl.href;
}

function buildApiUrl(url, page) {
    const apiUrl = new URL(url);
    apiUrl.searchParams.set('ajax', 'true');
    apiUrl.searchParams.set('page', String(page));
    return apiUrl;
}

function buildHeaders(referer) {
    return {
        accept: 'application/json, text/plain, */*',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
        origin: 'https://www.daraz.pk',
        referer,
        'sec-ch-ua': '"Google Chrome";v="133", "Not_A Brand";v="8", "Chromium";v="133"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': pickUserAgent(),
        'x-requested-with': 'XMLHttpRequest',
    };
}

function extractResponseMeta(payload) {
    const mainInfo = payload?.mainInfo || {};
    const page = toNumber(mainInfo.page) || 1;
    const pageSize = toNumber(mainInfo.pageSize) || DEFAULT_PAGE_SIZE;
    const totalResults = toNumber(mainInfo.totalResults) || 0;
    const totalPages = totalResults > 0 ? Math.ceil(totalResults / pageSize) : null;

    return {
        page,
        pageSize,
        totalResults,
        totalPages,
        noMorePages: Boolean(mainInfo.noMorePages),
        requestId: sanitizeText(mainInfo.RN),
        searchTerm: sanitizeText(mainInfo.title),
    };
}

function normalizeProductRecord(item, context) {
    if (!item) return null;

    const trace = parseTraceMap(item.clickTrace);
    const descriptionBullets = Array.isArray(item.description)
        ? item.description.map(sanitizeText).filter(Boolean)
        : [];
    const thumbnails = Array.isArray(item.thumbs)
        ? item.thumbs.map(normalizeAbsoluteUrl).filter(Boolean)
        : [];
    const badgeTypes = Array.isArray(item.icons)
        ? item.icons.map((icon) => sanitizeText(icon.bizType || icon.type)).filter(Boolean)
        : [];
    const badgeTexts = Array.isArray(item.icons)
        ? item.icons.map((icon) => sanitizeText(icon.text)).filter(Boolean)
        : [];
    const queryParams = new URLSearchParams(item.querystring || '');
    const productUrl = normalizeAbsoluteUrl(item.itemUrl || item.productUrl);
    const imageUrl = normalizeAbsoluteUrl(item.image);
    const price = toNumber(item.price ?? item.priceShow);
    const originalPrice = toNumber(item.originalPrice ?? item.originalPriceShow);

    let discountPct = null;
    if (price && originalPrice && originalPrice > price) {
        discountPct = Math.round(((originalPrice - price) / originalPrice) * 100);
    } else {
        discountPct = extractInteger(item.discount);
    }

    return {
        productId: sanitizeText(item.itemId || item.nid),
        skuId: sanitizeText(item.skuId),
        sku: sanitizeText(item.sku),
        title: sanitizeText(item.name),
        description: descriptionBullets.join(' | ') || null,
        descriptionBullets,
        brand: sanitizeText(item.brandName),
        brandId: sanitizeText(item.brandId),
        sellerName: sanitizeText(item.sellerName),
        sellerId: sanitizeText(item.sellerId),
        shopId: sanitizeText(trace.shop_id),
        location: sanitizeText(item.location),
        categoryIds: Array.isArray(item.categories) ? item.categories : [],
        price,
        priceText: sanitizeText(item.priceShow),
        originalPrice,
        originalPriceText: sanitizeText(item.originalPriceShow),
        discountText: sanitizeText(item.discount),
        discountPct,
        rating: toNumber(item.ratingScore),
        reviewCount: toNumber(item.review) || 0,
        soldCount: extractInteger(item.itemSoldCntShow) ?? extractInteger(queryParams.get('sale')),
        imageUrl,
        thumbnails,
        productUrl,
        directSimilarUrl: normalizeAbsoluteUrl(item.directSimilarUrl),
        inStock: item.inStock !== false,
        isSponsored: Boolean(item.isSponsored),
        promotionId: sanitizeText(item.promotionId),
        badgeTypes,
        badgeTexts,
        itemType: sanitizeText(item.tItemType),
        cheapestSku: sanitizeText(item.cheapest_sku),
        searchTerm: context.searchTerm,
        page: context.page,
        sourceUrl: context.sourceUrl,
        requestId: context.requestId || sanitizeText(queryParams.get('request_id')),
        source: 'daraz-catalog-api',
        scrapedAt: new Date().toISOString(),
    };
}

async function resolveProxyUrl(proxyConfiguration) {
    if (!proxyConfiguration) return undefined;

    const value = proxyConfiguration.newUrl();
    return typeof value?.then === 'function' ? await value : value;
}

async function fetchApiPage({ baseUrl, page, proxyConfiguration }) {
    const apiUrl = buildApiUrl(baseUrl, page);
    const proxyUrl = await resolveProxyUrl(proxyConfiguration);

    log.info(`Fetching page ${page}: ${apiUrl.href}`);

    const response = await gotScraping({
        url: apiUrl.href,
        headers: buildHeaders(baseUrl),
        proxyUrl,
        responseType: 'json',
        throwHttpErrors: false,
        timeout: { request: 30000 },
        retry: { limit: 2 },
    });

    if (response.statusCode >= 400) {
        throw new Error(`Daraz API responded with ${response.statusCode}`);
    }

    const payload = response.body;
    const items = Array.isArray(payload?.mods?.listItems) ? payload.mods.listItems : [];
    const meta = extractResponseMeta(payload);

    return { items, meta };
}

function resolveInitialUrls(input) {
    const urls = [];
    const startUrlEntries = parseStartUrls(input.startUrls);

    if (startUrlEntries.length > 0) {
        urls.push(...startUrlEntries);
    }

    if (urls.length === 0 && sanitizeText(input.searchQuery)) {
        urls.push(buildSearchUrl(input));
    }

    if (urls.length === 0) {
        urls.push(DEFAULT_START_URL);
    }

    return [...new Set(urls.map((url) => decorateListingUrl(url)))];
}

async function main() {
    const input = await loadActorInput();
    const {
        includeOutOfStock = false,
        proxyConfiguration: proxyConfig,
    } = input;

    const maxProducts = parsePositiveLimit(input.maxProducts, DEFAULT_MAX_PRODUCTS);
    const maxPages = parsePositiveLimit(input.maxPages, DEFAULT_MAX_PAGES);
    const initialUrls = resolveInitialUrls(input);
    const proxyConfiguration = proxyConfig
        ? await Actor.createProxyConfiguration({ ...proxyConfig })
        : undefined;

    let savedCount = 0;
    const seenKeys = new Set();

    for (const sourceUrl of initialUrls) {
        if (savedCount >= maxProducts) break;

        const normalizedSourceUrl = normalizeAbsoluteUrl(sourceUrl);
        if (!normalizedSourceUrl) continue;

        log.info(`Starting listing: ${normalizedSourceUrl}`);

        let page = 1;

        while (page <= maxPages && savedCount < maxProducts) {
            let payload;

            try {
                payload = await fetchApiPage({
                    baseUrl: normalizedSourceUrl,
                    page,
                    proxyConfiguration,
                });
            } catch (error) {
                log.warning(`Failed on page ${page}: ${error.message}`);
                break;
            }

            const { items, meta } = payload;
            if (items.length === 0) {
                log.info(`No products returned for page ${page}.`);
                break;
            }

            const records = items
                .map((item) => normalizeProductRecord(item, {
                    page,
                    requestId: meta.requestId,
                    searchTerm: meta.searchTerm,
                    sourceUrl: normalizedSourceUrl,
                }))
                .filter(Boolean)
                .map(stripNullValues)
                .filter((record) => includeOutOfStock || record.inStock !== false)
                .filter((record) => {
                    const recordKey = record.productId || record.skuId || record.productUrl;
                    if (!recordKey || seenKeys.has(recordKey)) return false;
                    seenKeys.add(recordKey);
                    return true;
                });

            if (records.length === 0) {
                log.info(`Page ${page} only contained duplicates after normalization.`);
            } else {
                const remaining = maxProducts === Infinity
                    ? records.length
                    : Math.max(0, maxProducts - savedCount);
                const batch = maxProducts === Infinity ? records : records.slice(0, remaining);

                if (batch.length > 0) {
                    await Actor.pushData(batch);
                    savedCount += batch.length;

                    if (page === 1) {
                        log.info(`Sample item: ${batch[0].title} (${batch[0].productId})`);
                    }

                    const limitLabel = maxProducts === Infinity ? 'unlimited' : String(maxProducts);
                    log.info(`Saved ${batch.length} products. Total: ${savedCount}/${limitLabel}`);
                }
            }

            if (meta.noMorePages) break;
            if (meta.totalPages && page >= meta.totalPages) break;

            page += 1;
            await sleep(700 + Math.floor(Math.random() * 500));
        }
    }

    if (savedCount === 0) {
        throw new Error('No products were extracted from the Daraz catalog endpoint.');
    }

    log.info(`Completed successfully. Total products saved: ${savedCount}`);
}

try {
    await main();
} catch (error) {
    log.exception(error, 'Actor failed');
    throw error;
} finally {
    await Actor.exit();
}
