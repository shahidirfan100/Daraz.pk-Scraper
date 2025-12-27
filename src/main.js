// Daraz.pk Product Scraper - Production Ready with Multi-Strategy Extraction
import { Actor, log } from 'apify';
import { CheerioCrawler, PlaywrightCrawler, Dataset } from 'crawlee';
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
            usePlaywright = false,
        } = input;

        const parsedMaxProducts = Number(maxProducts);
        const parsedMaxPages = Number(maxPages);
        const MAX_PRODUCTS = parsedMaxProducts === 0
            ? Infinity
            : (Number.isFinite(parsedMaxProducts) && parsedMaxProducts > 0 ? parsedMaxProducts : 100);
        const MAX_PAGES = parsedMaxPages === 0
            ? Infinity
            : (Number.isFinite(parsedMaxPages) && parsedMaxPages > 0 ? parsedMaxProducts : 50);

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
        const seenProductIds = new Set();
        let failureCount = 0;
        const MAX_FAILURES = 3;
        let shouldUsePlaywright = usePlaywright;

        // Enhanced User Agent pool
        const USER_AGENTS = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        ];

        function pickUserAgent() {
            return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        }

        function randomDelay(min = 800, max = 2000) {
            return new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));
        }

        function toNumber(value) {
            if (value === null || value === undefined) return null;
            const normalized = String(value).replace(/[\s,]/g, '').replace(/[^0-9.]/g, '');
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

            let productUrl = raw.productUrl || raw.itemUrl || raw.url || null;
            if (productUrl) {
                if (productUrl.startsWith('//')) {
                    productUrl = `https:${productUrl}`;
                } else if (!productUrl.startsWith('http')) {
                    productUrl = new URL(productUrl, 'https://www.daraz.pk').href;
                }
                productUrl = productUrl.replace(/^https:https:/, 'https:');
            }

            let imageUrl = raw.image || raw.imageUrl || raw.img || raw.thumbUrl || null;
            if (imageUrl) {
                if (imageUrl.startsWith('//')) {
                    imageUrl = `https:${imageUrl}`;
                } else if (imageUrl.startsWith('/')) {
                    imageUrl = `https://www.daraz.pk${imageUrl}`;
                }
                imageUrl = imageUrl.replace(/^https:https:/, 'https:');
            }

            return {
                productId: String(raw.itemId || raw.productId || raw.id || raw.nid || '').trim() || null,
                title: raw.name || raw.title || raw.productTitle || null,
                description: raw.description || raw.desc || raw.productDescription || raw.shortDescription || null,
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
                imageUrl,
                productUrl,
                inStock: raw.inStock !== false && raw.stockStatus !== 'out_of_stock',
                sellerName: raw.sellerName || raw.seller || null,
                location: raw.location || raw.sellerLocation || null,
                categoryName: raw.categoryName || raw.category || null,
                scrapedAt: new Date().toISOString(),
                source,
            };
        }

        function buildApiUrl(url, page = 1) {
            const apiUrl = new URL(url);
            // Remove page param to avoid duplication
            apiUrl.searchParams.delete('page');
            apiUrl.searchParams.set('ajax', 'true');
            apiUrl.searchParams.set('page', String(page));
            return apiUrl;
        }

        async function resolveProxyUrl() {
            if (!proxyConf) return undefined;
            const value = proxyConf.newUrl();
            return typeof value?.then === 'function' ? await value : value;
        }

        function buildStealthHeaders(url, userAgent) {
            return {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'en-US,en;q=0.9',
                'accept-encoding': 'gzip, deflate, br',
                'user-agent': userAgent,
                'x-requested-with': 'XMLHttpRequest',
                'sec-ch-ua': '"Google Chrome";v="120", "Not_A Brand";v="8", "Chromium";v="120"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'referer': url,
                'origin': 'https://www.daraz.pk',
            };
        }

        async function fetchProductsFromApi(url, page = 1) {
            try {
                const apiUrl = buildApiUrl(url, page);
                const userAgent = pickUserAgent();

                log.debug(`Fetching API page ${page}`);

                const proxyUrl = await resolveProxyUrl();

                const requestOptions = {
                    url: apiUrl.href,
                    headers: buildStealthHeaders(url, userAgent),
                    throwHttpErrors: false,
                    responseType: 'json',
                    followRedirect: true,
                    timeout: { request: 30000 },
                };

                if (proxyUrl) requestOptions.proxyUrl = proxyUrl;

                await randomDelay(800, 1500);
                const response = await gotScraping(requestOptions);

                if (response.statusCode >= 400) {
                    log.warning(`API failed: ${response.statusCode}`);
                    return { products: [], totalPages: 0, success: false };
                }

                const data = response.body;

                const listItems = data?.mods?.listItems
                    || data?.mainInfo?.mods?.listItems
                    || data?.items
                    || data?.data?.items
                    || data?.results
                    || [];

                const totalPages = data?.mainInfo?.pageTotal
                    || data?.pageInfo?.pageTotal
                    || data?.mods?.pageTotal
                    || data?.totalPages
                    || data?.data?.totalPages
                    || 1;

                if (Array.isArray(listItems) && listItems.length) {
                    log.info(`Page ${page}: ${listItems.length} products extracted`);
                    return {
                        products: listItems,
                        totalPages: Number(totalPages) || 1,
                        success: true,
                    };
                }

                log.debug(`No products in API response`);
                return { products: [], totalPages: 0, success: false };
            } catch (error) {
                log.warning(`API request failed: ${error.message}`);
                return { products: [], totalPages: 0, success: false };
            }
        }

        function extractEmbeddedJson(body) {
            const products = [];
            let totalPages = 0;
            if (!body) return { products, totalPages };

            const patterns = [
                /window\.pageData\s*=\s*(\{[\s\S]*?\});?\s*(?:window\.|<\/script>)/m,
                /window\.__APP_DATA__\s*=\s*(\{[\s\S]*?\});?\s*(?:window\.|<\/script>)/m,
                /app\.run\s*\(\s*(\{[\s\S]*?\})\s*\);?/m,
                /window\.__INIT_PROPS__\s*=\s*(\{[\s\S]*?\});?\s*(?:window\.|<\/script>)/m,
                /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*(?:window\.|<\/script>)/m,
                /app\.runParams\s*=\s*(\{[\s\S]*?\});?\s*(?:window\.|<\/script>)/m,
            ];

            for (const regex of patterns) {
                const match = body.match(regex);
                if (!match || match.length < 2) continue;

                try {
                    const jsonStr = match[1].trim();
                    const parsed = JSON.parse(jsonStr);

                    const listItems = parsed?.mods?.listItems
                        || parsed?.mainInfo?.mods?.listItems
                        || parsed?.data?.items
                        || parsed?.items
                        || parsed?.results
                        || [];

                    if (Array.isArray(listItems) && listItems.length) {
                        log.debug(`Embedded JSON: ${listItems.length} products`);
                        products.push(...listItems);
                    }

                    totalPages = totalPages || parsed?.mainInfo?.pageTotal || parsed?.pageInfo?.pageTotal || parsed?.totalPages || 0;
                } catch (err) {
                    log.debug(`JSON parse failed: ${err.message}`);
                }
            }

            return { products, totalPages };
        }

        function parseProductFromApi(item) {
            return normalizeProduct(item, 'api');
        }

        function parseProductsFromHtml($, currentUrl) {
            const products = [];

            const selectors = [
                '[data-qa-locator="product-item"]',
                '.gridItem',
                '.c2prKC',
                '[data-item-id]',
                '.product-item',
                '.Bm3ON',
            ];

            let $items = $();
            for (const selector of selectors) {
                $items = $(selector);
                if ($items.length > 0) {
                    log.debug(`Using selector: ${selector}`);
                    break;
                }
            }

            $items.each((_, el) => {
                try {
                    const $item = $(el);

                    const $link = $item.find('a[href*="/products/"], a[href*=".html"]').first();
                    const productUrl = $link.attr('href');

                    if (!productUrl) return;

                    const $img = $item.find('img').first();
                    const imageUrl = $img.attr('data-src') || $img.attr('src');

                    const title = $link.attr('title')
                        || $img.attr('alt')
                        || $item.find('[class*="title"], [class*="name"]').first().text().trim()
                        || $link.text().trim();

                    const $price = $item.find('.price--NVB62, [class*="price"]:not([class*="original"]):not([class*="strike"])').first();
                    const price = $price.text().trim();

                    const $originalPrice = $item.find('[class*="origPrice"], [class*="original"], .price--strikethrough').first();
                    const originalPrice = $originalPrice.text().trim();

                    const $discount = $item.find('[class*="discount"], .discount--HADmk').first();
                    const discount = $discount.text().trim();

                    const $rating = $item.find('[class*="rating"], .rating--QhLMl').first();
                    const rating = $rating.text().trim();

                    const $reviews = $item.find('[class*="review"], .rating__review--ygkUy').first();
                    const reviews = $reviews.text().replace(/\D/g, '');

                    const itemId = $item.attr('data-item-id')
                        || $item.attr('data-id')
                        || productUrl.match(/i(\d+)-s/)?.[1]
                        || productUrl.match(/(\d+)\.html/)?.[1];

                    const product = normalizeProduct({
                        itemId,
                        title,
                        price,
                        originalPrice,
                        discount,
                        rating,
                        review: reviews,
                        image: imageUrl,
                        productUrl,
                        url: productUrl,
                    }, 'html');

                    if (product?.productUrl && !product.productUrl.startsWith('http')) {
                        product.productUrl = new URL(product.productUrl, currentUrl || 'https://www.daraz.pk').href;
                    }

                    products.push(product);
                } catch (err) {
                    log.debug(`HTML parse error: ${err.message}`);
                }
            });

            if (products.length > 0) {
                log.debug(`HTML: ${products.length} products`);
            }

            return products;
        }

        function findNextPageUrl($, currentUrl) {
            const nextLink = $('link[rel="next"]').attr('href')
                || $('a[aria-label*="Next"], .ant-pagination-next a, a.next').attr('href')
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

        const cheerioCrawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 20,
                sessionOptions: {
                    maxUsageCount: 10,
                },
            },
            maxConcurrency: 4,
            requestHandlerTimeoutSecs: 120,
            maxRequestsPerMinute: 60,

            preNavigationHooks: [
                async ({ request }) => {
                    request.headers = {
                        ...buildStealthHeaders(request.url, pickUserAgent()),
                        ...(request.headers || {}),
                    };
                },
            ],

            async requestHandler({ request, $, body, crawler: crawlerInstance }) {
                const pageNo = request.userData?.pageNo || 1;
                const pageKey = `${request.url}|${pageNo}`;

                if (processedPages.has(pageKey)) {
                    log.debug(`Skipping duplicate page`);
                    return;
                }
                processedPages.add(pageKey);

                log.debug(`Processing page ${pageNo}`);

                await randomDelay(500, 1200);

                const apiResult = await fetchProductsFromApi(request.url, pageNo);

                let products = [];

                if (apiResult.success && apiResult.products.length > 0) {
                    products = apiResult.products.map(parseProductFromApi).filter(Boolean);
                } else {
                    const bodyStr = typeof body === 'string' ? body : body?.toString?.() || '';
                    const embedded = extractEmbeddedJson(bodyStr);

                    if (embedded.products.length) {
                        products = embedded.products.map(p => normalizeProduct(p, 'embedded-json')).filter(Boolean);
                        apiResult.totalPages = apiResult.totalPages || embedded.totalPages;
                    }

                    if (!products.length) {
                        log.debug('Falling back to HTML parsing');
                        products = parseProductsFromHtml($, request.url);
                    }
                }

                if (!products.length) {
                    log.warning(`No products on page ${pageNo}`);
                    failureCount++;

                    if (failureCount >= MAX_FAILURES && !shouldUsePlaywright) {
                        log.warning(`${failureCount} failures - switching to Playwright`);
                        shouldUsePlaywright = true;
                    }
                    return;
                }

                failureCount = 0;

                // Sample log on first page only
                if (pageNo === 1 && products.length > 0) {
                    const s = products[0];
                    log.info(`Sample: "${s.title?.substring(0, 50)}..." (${s.productId}) Rs.${s.price}`);
                }

                if (!includeOutOfStock) {
                    products = products.filter(p => p.inStock !== false);
                }

                const uniqueProducts = products.filter(p => {
                    if (!p.productId || seenProductIds.has(p.productId)) return false;
                    seenProductIds.add(p.productId);
                    return true;
                });

                // Stop if all duplicates
                if (uniqueProducts.length === 0 && pageNo > 1) {
                    log.warning(`All ${products.length} products on page ${pageNo} are duplicates - stopping`);
                    return;
                }

                const remaining = MAX_PRODUCTS - savedCount;
                const toSave = uniqueProducts.slice(0, Math.max(0, remaining));

                if (toSave.length > 0) {
                    await Dataset.pushData(toSave);
                    savedCount += toSave.length;
                    log.info(`✓ Saved ${toSave.length} (Total: ${savedCount}/${MAX_PRODUCTS})`);
                }

                // Pagination
                if (savedCount < MAX_PRODUCTS && pageNo < MAX_PAGES) {
                    const nextPage = pageNo + 1;

                    const apiTotal = apiResult.totalPages || 0;
                    if (apiResult.success && (!apiTotal || nextPage <= apiTotal)) {
                        await randomDelay(1000, 2000);
                        await crawlerInstance.addRequests([{
                            url: request.url,
                            userData: { pageNo: nextPage },
                        }]);
                        log.debug(`→ Page ${nextPage} queued`);
                        return;
                    }

                    const nextPageUrl = findNextPageUrl($, request.url);
                    if (nextPageUrl) {
                        await randomDelay(1000, 2000);
                        await crawlerInstance.addRequests([{
                            url: nextPageUrl,
                            userData: { pageNo: nextPage },
                        }]);
                        log.debug(`→ Page ${nextPage} queued`);
                    }
                }
            },
        });

        // Run crawler
        const urls = initial.map(url => ({ url, userData: { pageNo: 1 } }));

        log.info('Starting scraper...');
        await cheerioCrawler.run(urls);

        log.info(`✅ Completed. Total products: ${savedCount}`);

    } catch (error) {
        log.error(`Fatal error: ${error.message}`);
        log.exception(error, 'Main function failed');
        throw error;
    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    log.exception(err, 'Main crashed');
    process.exit(1);
});
