// Daraz.pk Product Scraper - Prioritizes JSON API with HTML fallback
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            startUrls,
            categoryUrl,
            searchQuery = '',
            maxProducts = 100,
            maxPages = 50,
            minPrice,
            maxPrice,
            sortBy = 'popularity',
            includeOutOfStock = false,
            proxyConfiguration,
        } = input;

        const parsedMaxProducts = Number(maxProducts);
        const parsedMaxPages = Number(maxPages);
        const MAX_PRODUCTS = parsedMaxProducts === 0
            ? Infinity
            : (Number.isFinite(parsedMaxProducts) && parsedMaxProducts > 0 ? parsedMaxProducts : 100);
        const MAX_PAGES = parsedMaxPages === 0
            ? Infinity
            : (Number.isFinite(parsedMaxPages) && parsedMaxPages > 0 ? parsedMaxPages : 50);

        // Build initial URLs
        const initial = [];

        // Priority 1: Multiple start URLs (highest priority)
        if (startUrls && typeof startUrls === 'string' && startUrls.trim()) {
            const urls = startUrls.split('\n')
                .map(url => url.trim())
                .filter(url => url && url.startsWith('http'));
            initial.push(...urls);
        }

        // Priority 2: Search query (creates Daraz.pk search URL)
        if (!initial.length && searchQuery) {
            const searchUrl = new URL('https://www.daraz.pk/catalog/');
            searchUrl.searchParams.set('q', searchQuery.trim());
            if (minPrice) searchUrl.searchParams.set('price', `${minPrice}-${maxPrice || ''}`);
            if (sortBy) searchUrl.searchParams.set('sort', sortBy);
            initial.push(searchUrl.href);
        }

        // Priority 3: Category URL (fallback)
        if (!initial.length && categoryUrl) {
            initial.push(categoryUrl);
        }

        // Default fallback
        if (!initial.length) {
            initial.push('https://www.daraz.pk/womens-fashion/');
        }

        const proxyConf = proxyConfiguration 
            ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
            : undefined;

        let savedCount = 0;
        const processedPages = new Set();

        const USER_AGENTS = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
        ];

        function pickUserAgent() {
            return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        }

        function toNumber(value) {
            if (value === null || value === undefined) return null;
            const normalized = String(value).replace(/[\s,]/g, '').replace(/[^\d.]/g, '');
            if (!normalized) return null;
            const parsed = Number(normalized);
            return Number.isFinite(parsed) ? parsed : null;
        }

        function normalizeProduct(raw, source = 'api') {
            if (!raw) return null;

            const priceText = raw.priceShow || raw.price || raw.finalPrice || raw.discountPrice || raw.priceText || null;
            const originalPriceText = raw.originalPriceShow || raw.originalPrice || raw.originalPriceText || null;
            const price = toNumber(priceText);
            const originalPrice = toNumber(originalPriceText);
            const discountPct = price && originalPrice
                ? Math.round(((originalPrice - price) / originalPrice) * 100)
                : toNumber(raw.discountPct) || null;

            const productUrl = raw.productUrl
                ? `https:${raw.productUrl}`.replace(/^https:https:/, 'https:')
                : raw.url
                    ? new URL(raw.url, 'https://www.daraz.pk').href
                    : null;

            return {
                productId: raw.itemId || raw.productId || raw.id || null,
                title: raw.name || raw.title || raw.productTitle || null,
                brand: raw.brandName || raw.brand || null,
                price,
                currency: 'PKR',
                priceText: priceText || null,
                originalPrice,
                originalPriceText: originalPriceText || null,
                discountPct,
                discountText: raw.discount || raw.discountText || (discountPct ? `${discountPct}%` : null),
                rating: toNumber(raw.ratingScore || raw.rating || raw.averageRating),
                reviewCount: toNumber(raw.review || raw.reviewCount || raw.reviews) || 0,
                imageUrl: raw.image
                    ? `https:${raw.image}`.replace(/^https:https:/, 'https:')
                    : raw.imageUrl || raw.img || null,
                productUrl,
                inStock: raw.inStock !== false,
                sellerName: raw.sellerName || raw.seller || null,
                location: raw.location || raw.sellerLocation || null,
                categoryName: raw.categoryName || raw.category || null,
                scrapedAt: new Date().toISOString(),
                source,
            };
        }

        function buildApiUrl(url, page = 1) {
            const apiUrl = new URL(url);
            apiUrl.searchParams.set('ajax', 'true');
            apiUrl.searchParams.set('page', String(page));
            return apiUrl;
        }

        /**
         * Extract product data from Daraz JSON API response
         */
        async function fetchProductsFromApi(url, page = 1) {
            try {
                const apiUrl = buildApiUrl(url, page);
                log.info(`Fetching API data from: ${apiUrl.href}`);

                const response = await gotScraping({
                    url: apiUrl.href,
                    headers: {
                        ...{
                            accept: 'application/json, text/plain, */*',
                            'accept-language': 'en-US,en;q=0.9',
                            'user-agent': pickUserAgent(),
                            'x-requested-with': 'XMLHttpRequest',
                        },
                        referer: url,
                    },
                    throwHttpErrors: false,
                    responseType: 'json',
                    followRedirect: true,
                    proxyUrl: proxyConf?.newUrl(),
                });

                if (response.statusCode >= 400) {
                    log.debug(`API returned status ${response.statusCode} for ${apiUrl.href}`);
                }

                const data = response.body;
                const listItems = data?.mods?.listItems
                    || data?.mainInfo?.mods?.listItems
                    || data?.items
                    || [];

                const totalPages = data?.mainInfo?.pageTotal
                    || data?.pageInfo?.pageTotal
                    || data?.mods?.pageTotal
                    || data?.totalPages
                    || 1;

                if (Array.isArray(listItems) && listItems.length) {
                    return {
                        products: listItems,
                        totalPages: Number(totalPages) || 1,
                        success: true,
                    };
                }

                return { products: [], totalPages: 0, success: false };
            } catch (error) {
                log.warning(`API fetch failed: ${error.message}`);
                return { products: [], totalPages: 0, success: false };
            }
        }

        function extractEmbeddedJson(body) {
            const products = [];
            let totalPages = 0;
            if (!body) return { products, totalPages };

            const patterns = [
                /window\.pageData\s*=\s*({[\s\S]*?});/m,
                /window\.__APP_DATA__\s*=\s*({[\s\S]*?});/m,
                /app\.runParams\s*=\s*({[\s\S]*?});/m,
                /window\.__INIT_PROPS__\s*=\s*({[\s\S]*?});/m,
            ];

            for (const regex of patterns) {
                const match = body.match(regex);
                if (!match || match.length < 2) continue;
                try {
                    const parsed = JSON.parse(match[1]);
                    const listItems = parsed?.mods?.listItems
                        || parsed?.mainInfo?.mods?.listItems
                        || parsed?.results
                        || [];
                    if (Array.isArray(listItems) && listItems.length) {
                        products.push(...listItems);
                    }
                    totalPages = totalPages || parsed?.mainInfo?.pageTotal || parsed?.pageInfo?.pageTotal || parsed?.totalPages || 0;
                } catch (err) {
                    log.debug(`Failed to parse embedded JSON: ${err.message}`);
                }
            }

            return { products, totalPages };
        }

        /**
         * Parse product from API JSON
         */
        function parseProductFromApi(item) {
            return normalizeProduct(item, 'api');
        }

        /**
         * Fallback: Extract products from HTML when API fails
         */
        function parseProductsFromHtml($, currentUrl) {
            const products = [];

            $('[data-qa-locator="product-item"]').each((_, el) => {
                try {
                    const $item = $(el);
                    const $link = $item.find('a[href*="/products/"]').first();
                    const productUrl = $link.attr('href');

                    if (!productUrl) return;

                    const $img = $item.find('img').first();
                    const $price = $item.find('[class*="price"], .price--NVB62').first();
                    const $originalPrice = $item.find('[class*="origPrice"], [class*="original"], .price--strikethrough').first();
                    const $discount = $item.find('[class*="discount"], .discount--HADmk').first();
                    const $rating = $item.find('[class*="rating"], .rating--QhLMl').first();
                    const $reviews = $item.find('[class*="review"], .rating__review--ygkUy').first();

                    const title = $link.attr('title') || $img.attr('alt') || $link.text().trim();
                    const imageUrl = $img.attr('src') || $img.attr('data-src');

                    const product = normalizeProduct({
                        title,
                        price: $price.text().trim(),
                        originalPrice: $originalPrice.text().trim(),
                        discount: $discount.text().trim(),
                        rating: $rating.text().trim(),
                        review: $reviews.text().replace(/\D/g, ''),
                        image: imageUrl,
                        productUrl,
                        url: productUrl,
                    }, 'html');

                    if (product?.productUrl && product.productUrl.startsWith('http') === false) {
                        product.productUrl = new URL(product.productUrl, currentUrl || 'https://www.daraz.pk').href;
                    }

                    products.push(product);
                } catch (err) {
                    log.debug(`Failed to parse product from HTML: ${err.message}`);
                }
            });

            return products;
        }

        /**
         * Find next page URL
         */
        function findNextPageUrl($, currentUrl) {
            const nextLink = $('link[rel="next"]').attr('href')
                || $('a[aria-label*="Next"], .ant-pagination-next a').attr('href')
                || $('a:contains("Next")').attr('href');
            if (nextLink) {
                try {
                    return new URL(nextLink, currentUrl).href;
                } catch {
                    return null;
                }
            }
            return null;
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: 6,
            requestHandlerTimeoutSecs: 90,

            async requestHandler({ request, $, body, crawler: crawlerInstance }) {
                const pageNo = request.userData?.pageNo || 1;
                const pageKey = `${request.url}|${pageNo}`;

                if (processedPages.has(pageKey)) {
                    log.debug(`Skipping duplicate page: ${pageKey}`);
                    return;
                }
                processedPages.add(pageKey);

                log.info(`Processing page ${pageNo}: ${request.url}`);

                // Priority 1: Try JSON API approach
                const apiResult = await fetchProductsFromApi(request.url, pageNo);

                let products = [];

                if (apiResult.success && apiResult.products.length > 0) {
                    log.info(`API fetch successful: ${apiResult.products.length} products found`);
                    products = apiResult.products.map(parseProductFromApi).filter(Boolean);
                } else {
                    // Priority 1.5: Embedded JSON in HTML
                    const embedded = extractEmbeddedJson(typeof body === 'string' ? body : body?.toString?.());
                    if (embedded.products.length) {
                        log.info(`Embedded JSON yielded ${embedded.products.length} products`);
                        products = embedded.products.map(p => normalizeProduct(p, 'embedded-json')).filter(Boolean);
                        apiResult.totalPages = apiResult.totalPages || embedded.totalPages;
                    }

                    // Priority 2: Fallback to HTML parsing
                    log.info('API failed, falling back to HTML parsing');
                    if (!products.length) {
                        products = parseProductsFromHtml($, request.url);
                        log.info(`HTML parsing: ${products.length} products extracted`);
                    }
                }

                // Filter products
                if (!includeOutOfStock) {
                    products = products.filter(p => p.inStock !== false);
                }

                // Save products
                const remaining = MAX_PRODUCTS - savedCount;
                const toSave = products.slice(0, Math.max(0, remaining));

                if (toSave.length > 0) {
                    await Dataset.pushData(toSave);
                    savedCount += toSave.length;
                    log.info(`Saved ${toSave.length} products (Total: ${savedCount}/${MAX_PRODUCTS})`);
                }

                // Handle pagination
                if (savedCount < MAX_PRODUCTS && pageNo < MAX_PAGES) {
                    const nextPage = pageNo + 1;

                    // Try API pagination first
                    const apiTotal = apiResult.totalPages || 0;
                    if (apiResult.success && (!apiTotal || nextPage <= apiTotal)) {
                        const nextUrl = buildApiUrl(request.url, nextPage);
                        await crawlerInstance.addRequests([{
                            url: nextUrl.href,
                            userData: { pageNo: nextPage },
                        }]);
                        log.info(`Enqueued API page ${nextPage}`);
                        return;
                    }

                    // Fallback to HTML pagination
                    const nextPageUrl = findNextPageUrl($, request.url);
                    if (nextPageUrl) {
                        await crawlerInstance.addRequests([{
                            url: nextPageUrl,
                            userData: { pageNo: nextPage },
                        }]);
                        log.info(`Enqueued HTML next page: ${nextPageUrl}`);
                    }
                }
            },
        });

        await crawler.run(initial.map(url => ({ url, userData: { pageNo: 1 } })));

        log.info(`Scraping completed. Total products saved: ${savedCount}`);

    } catch (error) {
        log.error(`Fatal error: ${error.message}`);
        throw error;
    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    log.exception(err, 'Main function failed');
    process.exit(1);
});
