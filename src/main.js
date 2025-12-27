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
            usePlaywright = false, // Auto-detect or force Playwright
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
            apiUrl.searchParams.set('ajax', 'true');
            apiUrl.searchParams.set('page', String(page));
            return apiUrl;
        }

        async function resolveProxyUrl() {
            if (!proxyConf) return undefined;
            const value = proxyConf.newUrl();
            return typeof value?.then === 'function' ? await value : value;
        }

        /**
         * Enhanced headers for stealth
         */
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

        /**
         * Priority 1: Extract product data from Daraz JSON API response
         */
        async function fetchProductsFromApi(url, page = 1) {
            try {
                const apiUrl = buildApiUrl(url, page);
                const userAgent = pickUserAgent();

                log.info(`[API] Fetching page ${page}: ${apiUrl.href}`);

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

                log.info(`[API] Response status: ${response.statusCode}, Content-Type: ${response.headers['content-type']}`);

                if (response.statusCode >= 400) {
                    log.warning(`[API] Failed with status ${response.statusCode}`);
                    return { products: [], totalPages: 0, success: false };
                }

                const data = response.body;

                // Try multiple JSON paths for Daraz API structure
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
                    log.info(`[API] ✓ Extracted ${listItems.length} products from JSON API`);
                    return {
                        products: listItems,
                        totalPages: Number(totalPages) || 1,
                        success: true,
                    };
                }

                log.debug(`[API] No products found in API response structure`);
                return { products: [], totalPages: 0, success: false };
            } catch (error) {
                log.warning(`[API] Request failed: ${error.message}`);
                return { products: [], totalPages: 0, success: false };
            }
        }

        /**
         * Priority 1.5: Extract embedded JSON from HTML
         */
        function extractEmbeddedJson(body) {
            const products = [];
            let totalPages = 0;
            if (!body) return { products, totalPages };

            // Enhanced patterns for Daraz's embedded JSON
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

                    // Try multiple paths in the parsed object
                    const listItems = parsed?.mods?.listItems
                        || parsed?.mainInfo?.mods?.listItems
                        || parsed?.data?.items
                        || parsed?.items
                        || parsed?.results
                        || [];

                    if (Array.isArray(listItems) && listItems.length) {
                        log.info(`[JSON Embedded] ✓ Found ${listItems.length} products in ${regex.source.substring(0, 30)}...`);
                        products.push(...listItems);
                    }

                    totalPages = totalPages
                        || parsed?.mainInfo?.pageTotal
                        || parsed?.pageInfo?.pageTotal
                        || parsed?.totalPages
                        || 0;
                } catch (err) {
                    log.debug(`[JSON Embedded] Failed to parse pattern ${regex.source.substring(0, 30)}: ${err.message}`);
                }
            }

            // Also check for JSON-LD structured data
            try {
                const jsonLdPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
                let jsonLdMatch;
                while ((jsonLdMatch = jsonLdPattern.exec(body)) !== null) {
                    const jsonLd = JSON.parse(jsonLdMatch[1]);
                    if (jsonLd['@type'] === 'ItemList' && Array.isArray(jsonLd.itemListElement)) {
                        log.info(`[JSON-LD] ✓ Found ${jsonLd.itemListElement.length} products in structured data`);
                        products.push(...jsonLd.itemListElement.map(item => item.item || item));
                    }
                }
            } catch (err) {
                log.debug(`[JSON-LD] Not found or failed to parse`);
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
         * Priority 2: Fallback HTML parsing with improved selectors
         */
        function parseProductsFromHtml($, currentUrl) {
            const products = [];

            // Multiple selector strategies for Daraz product cards
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
                    log.info(`[HTML] Using selector: ${selector} (${$items.length} items)`);
                    break;
                }
            }

            $items.each((_, el) => {
                try {
                    const $item = $(el);

                    // Extract product link
                    const $link = $item.find('a[href*="/products/"], a[href*=".html"]').first();
                    const productUrl = $link.attr('href');

                    if (!productUrl) return;

                    // Extract image
                    const $img = $item.find('img').first();
                    const imageUrl = $img.attr('data-src') || $img.attr('src');

                    // Extract title
                    const title = $link.attr('title')
                        || $img.attr('alt')
                        || $item.find('[class*="title"], [class*="name"]').first().text().trim()
                        || $link.text().trim();

                    // Extract price with multiple selector fallbacks
                    const $price = $item.find('.price--NVB62, [class*="price"]:not([class*="original"]):not([class*="strike"])').first();
                    const price = $price.text().trim();

                    // Extract original price
                    const $originalPrice = $item.find('[class*="origPrice"], [class*="original"], .price--strikethrough').first();
                    const originalPrice = $originalPrice.text().trim();

                    // Extract discount
                    const $discount = $item.find('[class*="discount"], .discount--HADmk').first();
                    const discount = $discount.text().trim();

                    // Extract rating
                    const $rating = $item.find('[class*="rating"], .rating--QhLMl').first();
                    const rating = $rating.text().trim();

                    // Extract reviews
                    const $reviews = $item.find('[class*="review"], .rating__review--ygkUy').first();
                    const reviews = $reviews.text().replace(/\D/g, '');

                    // Extract product ID from data attribute or URL
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
                    log.debug(`[HTML] Failed to parse product: ${err.message}`);
                }
            });

            if (products.length > 0) {
                log.info(`[HTML] ✓ Extracted ${products.length} products from HTML`);
            }

            return products;
        }

        /**
         * Find next page URL
         */
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

        /**
         * Cheerio-based crawler (default, fast)
         */
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
                    log.debug(`[Cheerio] Skipping duplicate: ${pageKey}`);
                    return;
                }
                processedPages.add(pageKey);

                log.info(`[Cheerio] Processing page ${pageNo}: ${request.url}`);

                await randomDelay(500, 1200);

                // Priority 1: Try JSON API approach
                const apiResult = await fetchProductsFromApi(request.url, pageNo);

                let products = [];

                if (apiResult.success && apiResult.products.length > 0) {
                    products = apiResult.products.map(parseProductFromApi).filter(Boolean);
                } else {
                    // Priority 1.5: Embedded JSON in HTML
                    const bodyStr = typeof body === 'string' ? body : body?.toString?.() || '';
                    const embedded = extractEmbeddedJson(bodyStr);

                    if (embedded.products.length) {
                        products = embedded.products.map(p => normalizeProduct(p, 'embedded-json')).filter(Boolean);
                        apiResult.totalPages = apiResult.totalPages || embedded.totalPages;
                    }

                    // Priority 2: Fallback to HTML parsing
                    if (!products.length) {
                        log.info('[Cheerio] Falling back to HTML parsing');
                        products = parseProductsFromHtml($, request.url);
                    }
                }

                if (!products.length) {
                    log.warning(`[Cheerio] ⚠️  No products found on page ${pageNo}`);
                    failureCount++;

                    if (failureCount >= MAX_FAILURES && !shouldUsePlaywright) {
                        log.warning(`[Cheerio] ${failureCount} consecutive failures. Switching to Playwright...`);
                        shouldUsePlaywright = true;
                    }
                    return;
                }

                // Reset failure count on success
                failureCount = 0;

                // Log first product sample for debugging
                if (products.length > 0) {
                    log.info(`[Sample Product] ${JSON.stringify(products[0], null, 2)}`);
                }

                // Filter out of stock
                if (!includeOutOfStock) {
                    products = products.filter(p => p.inStock !== false);
                }

                // Deduplicate by productId
                const uniqueProducts = products.filter(p => {
                    if (!p.productId || seenProductIds.has(p.productId)) return false;
                    seenProductIds.add(p.productId);
                    return true;
                });

                // Save products
                const remaining = MAX_PRODUCTS - savedCount;
                const toSave = uniqueProducts.slice(0, Math.max(0, remaining));

                if (toSave.length > 0) {
                    await Dataset.pushData(toSave);
                    savedCount += toSave.length;
                    log.info(`[Cheerio] ✓ Saved ${toSave.length} products (Total: ${savedCount}/${MAX_PRODUCTS})`);
                }

                // Handle pagination
                if (savedCount < MAX_PRODUCTS && pageNo < MAX_PAGES) {
                    const nextPage = pageNo + 1;

                    // Try API pagination first
                    const apiTotal = apiResult.totalPages || 0;
                    if (apiResult.success && (!apiTotal || nextPage <= apiTotal)) {
                        await randomDelay(1000, 2000);
                        await crawlerInstance.addRequests([{
                            url: request.url,
                            userData: { pageNo: nextPage },
                        }]);
                        log.info(`[Cheerio] → Enqueued page ${nextPage} (API pagination)`);
                        return;
                    }

                    // Fallback to HTML pagination
                    const nextPageUrl = findNextPageUrl($, request.url);
                    if (nextPageUrl) {
                        await randomDelay(1000, 2000);
                        await crawlerInstance.addRequests([{
                            url: nextPageUrl,
                            userData: { pageNo: nextPage },
                        }]);
                        log.info(`[Cheerio] → Enqueued page ${nextPage}: ${nextPageUrl}`);
                    } else {
                        log.info(`[Cheerio] No more pages to scrape`);
                    }
                }
            },
        });

        /**
         * Playwright-based crawler (fallback for JS-heavy pages)
         */
        const playwrightCrawler = new PlaywrightCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 10,
                sessionOptions: {
                    maxUsageCount: 5,
                },
            },
            maxConcurrency: 2,
            requestHandlerTimeoutSecs: 180,
            launchContext: {
                launcher: 'chromium',
                launcherOptions: {
                    headless: true,
                    args: [
                        '--disable-blink-features=AutomationControlled',
                        '--disable-web-security',
                        '--disable-features=IsolateOrigins,site-per-process',
                    ],
                },
            },

            async requestHandler({ request, page, crawler: crawlerInstance }) {
                const pageNo = request.userData?.pageNo || 1;
                const pageKey = `${request.url}|${pageNo}`;

                if (processedPages.has(pageKey)) {
                    log.debug(`[Playwright] Skipping duplicate: ${pageKey}`);
                    return;
                }
                processedPages.add(pageKey);

                log.info(`[Playwright] Processing page ${pageNo}: ${request.url}`);

                // Wait for content to load
                await page.waitForLoadState('networkidle', { timeout: 30000 });
                await randomDelay(1500, 3000);

                // Try to extract embedded JSON from window objects
                const embeddedData = await page.evaluate(() => {
                    const sources = [
                        window.pageData,
                        window.__APP_DATA__,
                        window.__INITIAL_STATE__,
                        window.__INIT_PROPS__,
                    ];

                    for (const source of sources) {
                        if (source) {
                            const items = source?.mods?.listItems
                                || source?.mainInfo?.mods?.listItems
                                || source?.items
                                || source?.data?.items
                                || [];
                            if (Array.isArray(items) && items.length > 0) {
                                return {
                                    products: items,
                                    totalPages: source?.mainInfo?.pageTotal || source?.totalPages || 0,
                                };
                            }
                        }
                    }
                    return { products: [], totalPages: 0 };
                });

                let products = [];

                if (embeddedData.products.length > 0) {
                    log.info(`[Playwright] ✓ Extracted ${embeddedData.products.length} products from window objects`);
                    products = embeddedData.products.map(p => normalizeProduct(p, 'playwright-json')).filter(Boolean);
                } else {
                    // Fallback to HTML parsing
                    log.info('[Playwright] Falling back to HTML parsing');
                    const content = await page.content();
                    const { parseProductsFromHtml: parseHtml } = await import('cheerio').then(cheerio => {
                        const $ = cheerio.load(content);
                        return { parseProductsFromHtml: () => parseProductsFromHtml($, request.url) };
                    });
                    products = parseHtml();
                }

                if (!products.length) {
                    log.warning(`[Playwright] ⚠️  No products found on page ${pageNo}`);
                    return;
                }

                log.info(`[Sample Product] ${JSON.stringify(products[0], null, 2)}`);

                // Filter and deduplicate
                if (!includeOutOfStock) {
                    products = products.filter(p => p.inStock !== false);
                }

                const uniqueProducts = products.filter(p => {
                    if (!p.productId || seenProductIds.has(p.productId)) return false;
                    seenProductIds.add(p.productId);
                    return true;
                });

                const remaining = MAX_PRODUCTS - savedCount;
                const toSave = uniqueProducts.slice(0, Math.max(0, remaining));

                if (toSave.length > 0) {
                    await Dataset.pushData(toSave);
                    savedCount += toSave.length;
                    log.info(`[Playwright] ✓ Saved ${toSave.length} products (Total: ${savedCount}/${MAX_PRODUCTS})`);
                }

                // Pagination
                if (savedCount < MAX_PRODUCTS && pageNo < MAX_PAGES) {
                    const nextPage = pageNo + 1;
                    const totalPages = embeddedData.totalPages || 0;

                    if (!totalPages || nextPage <= totalPages) {
                        await randomDelay(2000, 4000);
                        await crawlerInstance.addRequests([{
                            url: request.url,
                            userData: { pageNo: nextPage },
                        }]);
                        log.info(`[Playwright] → Enqueued page ${nextPage}`);
                    }
                }
            },
        });

        // Run the appropriate crawler
        const urls = initial.map(url => ({ url, userData: { pageNo: 1 } }));

        if (shouldUsePlaywright) {
            log.info('🎭 Starting Playwright crawler...');
            await playwrightCrawler.run(urls);
        } else {
            log.info('⚡ Starting Cheerio crawler (fast mode)...');
            await cheerioCrawler.run(urls);

            // If Cheerio failed completely and Playwright wasn't already tried
            if (savedCount === 0 && !shouldUsePlaywright) {
                log.warning('⚠️  Cheerio failed to extract any products. Retrying with Playwright...');
                processedPages.clear();
                seenProductIds.clear();
                await playwrightCrawler.run(urls);
            }
        }

        log.info(`✅ Scraping completed. Total products saved: ${savedCount}`);

    } catch (error) {
        log.error(`❌ Fatal error: ${error.message}`);
        log.exception(error, 'Main function failed');
        throw error;
    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    log.exception(err, 'Main function crashed');
    process.exit(1);
});
