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

        const MAX_PRODUCTS = Number.isFinite(+maxProducts) && maxProducts > 0 ? maxProducts : 100;
        const MAX_PAGES = Number.isFinite(+maxPages) && maxPages > 0 ? maxPages : 50;

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
        const processedUrls = new Set();

        /**
         * Extract product data from Daraz JSON API response
         */
        async function fetchProductsFromApi(url, page = 1) {
            try {
                const apiUrl = new URL(url);
                apiUrl.searchParams.set('page', String(page));
                apiUrl.searchParams.set('ajax', 'true');

                log.info(`Fetching API data from: ${apiUrl.href}`);

                const response = await gotScraping({
                    url: apiUrl.href,
                    responseType: 'json',
                    proxyUrl: proxyConf?.newUrl(),
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'X-Requested-With': 'XMLHttpRequest',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    },
                });

                const data = response.body;
                
                if (data?.mods?.listItems) {
                    return {
                        products: data.mods.listItems,
                        totalPages: data.mainInfo?.pageTotal || 1,
                        success: true,
                    };
                }

                return { products: [], totalPages: 0, success: false };
            } catch (error) {
                log.warning(`API fetch failed: ${error.message}`);
                return { products: [], totalPages: 0, success: false };
            }
        }

        /**
         * Parse product from API JSON
         */
        function parseProductFromApi(item) {
            if (!item) return null;

            const productUrl = item.productUrl 
                ? `https:${item.productUrl}`.replace(/^https:https:/, 'https:')
                : null;

            return {
                productId: item.itemId || item.productId || null,
                title: item.name || item.title || null,
                brand: item.brandName || null,
                price: item.price || item.priceShow || null,
                originalPrice: item.originalPrice || item.originalPriceShow || null,
                discount: item.discount || null,
                rating: item.ratingScore || item.rating || null,
                reviewCount: item.review || item.reviewCount || 0,
                imageUrl: item.image ? `https:${item.image}`.replace(/^https:https:/, 'https:') : null,
                productUrl: productUrl,
                inStock: item.inStock !== false,
                sellerName: item.sellerName || null,
                location: item.location || null,
                categoryName: item.categoryName || null,
                scrapedAt: new Date().toISOString(),
                source: 'api',
            };
        }

        /**
         * Fallback: Extract products from HTML when API fails
         */
        function parseProductsFromHtml($) {
            const products = [];
            
            $('[data-qa-locator="product-item"]').each((_, el) => {
                try {
                    const $item = $(el);
                    const $link = $item.find('a[href*="/products/"]').first();
                    const productUrl = $link.attr('href');
                    
                    if (!productUrl) return;

                    const $img = $item.find('img').first();
                    const $price = $item.find('[class*="price"]').first();
                    const $originalPrice = $item.find('[class*="origPrice"], [class*="original"]').first();
                    const $discount = $item.find('[class*="discount"]').first();
                    const $rating = $item.find('[class*="rating"]').first();
                    const $reviews = $item.find('[class*="review"]').first();

                    const title = $link.attr('title') || $img.attr('alt') || $link.text().trim();
                    const imageUrl = $img.attr('src') || $img.attr('data-src');
                    
                    const product = {
                        title: title || null,
                        price: $price.text().trim() || null,
                        originalPrice: $originalPrice.text().trim() || null,
                        discount: $discount.text().trim() || null,
                        rating: parseFloat($rating.text().trim()) || null,
                        reviewCount: parseInt($reviews.text().replace(/\D/g, ''), 10) || 0,
                        imageUrl: imageUrl ? `https:${imageUrl}`.replace(/^https:https:/, 'https:') : null,
                        productUrl: productUrl ? `https://www.daraz.pk${productUrl}` : null,
                        scrapedAt: new Date().toISOString(),
                        source: 'html',
                    };

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
            const nextLink = $('a[aria-label*="Next"], .ant-pagination-next a').attr('href');
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
            maxConcurrency: 5,
            requestHandlerTimeoutSecs: 90,
            
            async requestHandler({ request, $, body, enqueueLinks, crawler: crawlerInstance }) {
                const pageNo = request.userData?.pageNo || 1;

                if (processedUrls.has(request.url)) {
                    log.debug(`Skipping duplicate URL: ${request.url}`);
                    return;
                }
                processedUrls.add(request.url);

                log.info(`Processing page ${pageNo}: ${request.url}`);

                // Priority 1: Try JSON API approach
                const apiResult = await fetchProductsFromApi(request.url, pageNo);
                
                let products = [];
                
                if (apiResult.success && apiResult.products.length > 0) {
                    log.info(`✓ API fetch successful: ${apiResult.products.length} products found`);
                    products = apiResult.products.map(parseProductFromApi).filter(Boolean);
                } else {
                    // Priority 2: Fallback to HTML parsing
                    log.info('API failed, falling back to HTML parsing');
                    products = parseProductsFromHtml($);
                    log.info(`✓ HTML parsing: ${products.length} products extracted`);
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
                    if (apiResult.success && nextPage <= apiResult.totalPages) {
                        const nextUrl = new URL(request.url);
                        nextUrl.searchParams.set('page', String(nextPage));
                        
                        await crawlerInstance.addRequests([{
                            url: nextUrl.href,
                            userData: { pageNo: nextPage },
                        }]);
                        log.info(`Enqueued API page ${nextPage}`);
                    } else {
                        // Fallback to HTML pagination
                        const nextPageUrl = findNextPageUrl($, request.url);
                        if (nextPageUrl) {
                            await enqueueLinks({
                                urls: [nextPageUrl],
                                userData: { pageNo: nextPage },
                            });
                            log.info(`Enqueued HTML next page: ${nextPageUrl}`);
                        }
                    }
                }
            },
        });

        await crawler.run(initial.map(url => ({ url, userData: { pageNo: 1 } })));
        
        log.info(`✓ Scraping completed. Total products saved: ${savedCount}`);
        
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
