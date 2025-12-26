# Daraz.pk Product Scraper

Extract comprehensive product data from Daraz.pk, Pakistan's leading e-commerce marketplace. This scraper employs intelligent dual-extraction methodology, prioritizing efficient JSON API calls with automatic HTML fallback for maximum reliability and performance.

## Key Features

<ul>
<li><strong>Intelligent Extraction</strong> – Automatically attempts JSON API extraction first, seamlessly falls back to HTML parsing if needed</li>
<li><strong>Comprehensive Data</strong> – Captures titles, prices, discounts, ratings, reviews, brands, images, and product URLs</li>
<li><strong>Advanced Filtering</strong> – Filter by price range, sort options, stock availability, and custom categories</li>
<li><strong>Pagination Support</strong> – Automatically navigates through multiple pages to collect desired product count</li>
<li><strong>High Performance</strong> – Optimized for speed with configurable concurrency and request limits</li>
<li><strong>Proxy Support</strong> – Built-in Apify Proxy integration for reliable, uninterrupted scraping</li>
</ul>

## Use Cases

<ul>
<li><strong>Price Monitoring</strong> – Track product prices and discount trends over time</li>
<li><strong>Market Research</strong> – Analyze product availability, pricing strategies, and market trends</li>
<li><strong>Competitor Analysis</strong> – Compare products, prices, and ratings across categories</li>
<li><strong>Inventory Tracking</strong> – Monitor stock availability for specific products or categories</li>
<li><strong>Data Analytics</strong> – Build datasets for e-commerce insights and business intelligence</li>
</ul>

## Input Configuration

### Start URLs & Search

<table>
<thead>
<tr>
<th>Parameter</th>
<th>Type</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>Category URL</strong></td>
<td>String</td>
<td>Daraz.pk category page URL (e.g., <code>https://www.daraz.pk/womens-fashion/</code>)</td>
</tr>
<tr>
<td><strong>Search Query</strong></td>
<td>String</td>
<td>Product search keywords (e.g., "iPhone 15", "dress", "laptop"). Creates standard Daraz.pk catalog URL</td>
</tr>
<tr>
<td><strong>Multiple Start URLs</strong></td>
<td>String</td>
<td>List of Daraz.pk URLs to scrape from (one URL per line). Highest priority - overrides other URL options</td>
</tr>
</tbody>
</table>

### Limits & Performance

<table>
<thead>
<tr>
<th>Parameter</th>
<th>Type</th>
<th>Default</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>Maximum Products</strong></td>
<td>Integer</td>
<td>100</td>
<td>Maximum number of products to scrape (0 = unlimited)</td>
</tr>
<tr>
<td><strong>Maximum Pages</strong></td>
<td>Integer</td>
<td>50</td>
<td>Safety limit on pagination depth</td>
</tr>
</tbody>
</table>

### Filtering & Sorting

<table>
<thead>
<tr>
<th>Parameter</th>
<th>Type</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>Minimum Price</strong></td>
<td>Number</td>
<td>Filter products by minimum price in PKR</td>
</tr>
<tr>
<td><strong>Maximum Price</strong></td>
<td>Number</td>
<td>Filter products by maximum price in PKR</td>
</tr>
<tr>
<td><strong>Sort By</strong></td>
<td>Select</td>
<td>Options: Popularity, Price (Low/High), Newest, Top Rated</td>
</tr>
<tr>
<td><strong>Include Out of Stock</strong></td>
<td>Boolean</td>
<td>Include products currently unavailable (default: false)</td>
</tr>
</tbody>
</table>

### Proxy Configuration

<table>
<thead>
<tr>
<th>Parameter</th>
<th>Type</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>Proxy Configuration</strong></td>
<td>Object</td>
<td>Apify Proxy settings - Residential proxies recommended for optimal results</td>
</tr>
</tbody>
</table>

## Output Format

Each scraped product contains the following structured data:

```json
{
  "productId": "123456789",
  "title": "Women Summer Dress - Floral Print",
  "brand": "Fashion Brand",
  "price": "Rs. 1,299",
  "originalPrice": "Rs. 2,500",
  "discount": "48% OFF",
  "rating": 4.5,
  "reviewCount": 127,
  "imageUrl": "https://static-01.daraz.pk/p/image.jpg",
  "productUrl": "https://www.daraz.pk/products/...",
  "inStock": true,
  "sellerName": "Official Store",
  "location": "Lahore",
  "categoryName": "Women's Fashion",
  "scrapedAt": "2025-12-26T10:30:00.000Z",
  "source": "api"
}
```

### Field Descriptions

<table>
<thead>
<tr>
<th>Field</th>
<th>Type</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>productId</code></td>
<td>String</td>
<td>Unique Daraz product identifier</td>
</tr>
<tr>
<td><code>title</code></td>
<td>String</td>
<td>Product name and description</td>
</tr>
<tr>
<td><code>brand</code></td>
<td>String</td>
<td>Brand or manufacturer name</td>
</tr>
<tr>
<td><code>price</code></td>
<td>String</td>
<td>Current selling price in PKR</td>
</tr>
<tr>
<td><code>originalPrice</code></td>
<td>String</td>
<td>Original price before discount</td>
</tr>
<tr>
<td><code>discount</code></td>
<td>String</td>
<td>Discount percentage or amount</td>
</tr>
<tr>
<td><code>rating</code></td>
<td>Number</td>
<td>Average customer rating (0-5)</td>
</tr>
<tr>
<td><code>reviewCount</code></td>
<td>Number</td>
<td>Total number of customer reviews</td>
</tr>
<tr>
<td><code>imageUrl</code></td>
<td>String</td>
<td>Primary product image URL</td>
</tr>
<tr>
<td><code>productUrl</code></td>
<td>String</td>
<td>Direct link to product page</td>
</tr>
<tr>
<td><code>inStock</code></td>
<td>Boolean</td>
<td>Stock availability status</td>
</tr>
<tr>
<td><code>sellerName</code></td>
<td>String</td>
<td>Merchant or seller name</td>
</tr>
<tr>
<td><code>location</code></td>
<td>String</td>
<td>Seller location</td>
</tr>
<tr>
<td><code>categoryName</code></td>
<td>String</td>
<td>Product category</td>
</tr>
<tr>
<td><code>scrapedAt</code></td>
<td>String</td>
<td>ISO timestamp of data extraction</td>
</tr>
<tr>
<td><code>source</code></td>
<td>String</td>
<td>Extraction method: "api" or "html"</td>
</tr>
</tbody>
</table>

## Quick Start Examples

### Example 1: Scrape Women's Fashion Category

```json
{
  "categoryUrl": "https://www.daraz.pk/womens-fashion/",
  "maxProducts": 100,
  "sortBy": "popularity"
}
```

### Example 2: Search for Specific Products

```json
{
  "searchQuery": "iPhone 15 Pro Max",
  "maxProducts": 50,
  "sortBy": "priceasc",
  "minPrice": 200000,
  "maxPrice": 300000
}
```

### Example 3: Multiple Categories

```json
{
  "startUrls": "https://www.daraz.pk/mens-fashion/\nhttps://www.daraz.pk/womens-fashion/\nhttps://www.daraz.pk/electronic-devices/",
  "maxProducts": 200,
  "includeOutOfStock": true
}
```

*Note: Use the textarea editor to easily add multiple URLs, one per line.*

### Example 4: Price Range Filter

```json
{
  "categoryUrl": "https://www.daraz.pk/laptops/",
  "minPrice": 50000,
  "maxPrice": 100000,
  "sortBy": "rating",
  "maxProducts": 100
}
```

## Technical Specifications

### Extraction Methodology

<ol>
<li><strong>Primary Method: JSON API</strong>
<ul>
<li>Sends AJAX requests to Daraz.pk internal API endpoints</li>
<li>Parses structured JSON responses for maximum accuracy</li>
<li>Significantly faster than HTML parsing</li>
<li>Provides complete product metadata</li>
</ul>
</li>
<li><strong>Fallback Method: HTML Parsing</strong>
<ul>
<li>Activates automatically when API extraction fails</li>
<li>Uses CSS selectors to extract product information</li>
<li>Ensures continuous operation under varying conditions</li>
<li>Maintains data consistency across methods</li>
</ul>
</li>
</ol>

### Performance Characteristics

<ul>
<li><strong>Concurrency</strong> – 5 parallel requests for optimal balance</li>
<li><strong>Request Timeout</strong> – 90 seconds per request</li>
<li><strong>Retry Strategy</strong> – 3 automatic retries with exponential backoff</li>
<li><strong>Session Management</strong> – Cookie-based session handling for consistency</li>
<li><strong>Deduplication</strong> – Built-in URL deduplication prevents duplicate entries</li>
</ul>

### System Requirements

<ul>
<li><strong>Node.js Version</strong> – 22 or higher</li>
<li><strong>Memory</strong> – Minimum 512MB recommended</li>
<li><strong>Proxy</strong> – Apify Residential Proxy recommended for enterprise use</li>
</ul>

## Best Practices

### Optimal Configuration

<ul>
<li>Use <strong>Residential Proxies</strong> for large-scale scraping to avoid rate limits</li>
<li>Set realistic <code>maxProducts</code> limits based on your data needs</li>
<li>Enable <code>includeOutOfStock: false</code> for active inventory only</li>
<li>Use price filters to narrow results and improve efficiency</li>
</ul>

### Rate Limiting

<ul>
<li>Default concurrency (5) balances speed and server load</li>
<li>Automatic session pooling prevents IP-based blocking</li>
<li>Built-in retry logic handles temporary failures gracefully</li>
</ul>

### Data Quality

<ul>
<li>JSON API extraction provides highest data accuracy</li>
<li>HTML fallback ensures completeness when API unavailable</li>
<li>Timestamps enable temporal analysis of price changes</li>
<li>Source field identifies extraction method for quality control</li>
</ul>

## Common Issues & Solutions

<details>
<summary><strong>No products returned</strong></summary>
<ul>
<li>Verify the URL is a valid Daraz.pk category or search page</li>
<li>Check if price filters are too restrictive</li>
<li>Ensure category exists and contains products</li>
<li>Try enabling proxy configuration</li>
</ul>
</details>

<details>
<summary><strong>Scraping stopped prematurely</strong></summary>
<ul>
<li>Check <code>maxProducts</code> and <code>maxPages</code> limits</li>
<li>Verify proxy configuration is active</li>
<li>Review run logs for error messages</li>
<li>Consider increasing timeout settings</li>
</ul>
</details>

<details>
<summary><strong>Missing product data fields</strong></summary>
<ul>
<li>Some products may lack certain fields (brand, reviews, etc.)</li>
<li>HTML fallback may extract fewer fields than API method</li>
<li>Check <code>source</code> field to identify extraction method</li>
<li>Missing fields returned as <code>null</code> in output</li>
</ul>
</details>

<details>
<summary><strong>Rate limiting or blocking</strong></summary>
<ul>
<li>Enable Apify Proxy with Residential proxy group</li>
<li>Reduce <code>maxConcurrency</code> in code if needed</li>
<li>Add delays between requests for gentler scraping</li>
<li>Rotate user agents and headers</li>
</ul>
</details>

## Output Integration

### Export Formats

Results can be exported in multiple formats:

<ul>
<li><strong>JSON</strong> – Structured data for programmatic access</li>
<li><strong>CSV</strong> – Spreadsheet compatibility for analysis</li>
<li><strong>Excel</strong> – Direct import to Microsoft Excel</li>
<li><strong>XML</strong> – Legacy system integration</li>
<li><strong>RSS</strong> – Feed-based consumption</li>
</ul>

### API Access

<ul>
<li>Access scraped data via Apify API endpoints</li>
<li>Real-time data retrieval during scraping</li>
<li>Webhook integration for automated workflows</li>
<li>Scheduled runs for periodic data collection</li>
</ul>

## Pricing & Credits

This scraper consumes Apify platform credits based on:

<ul>
<li><strong>Compute Units</strong> – Processing time and memory usage</li>
<li><strong>Proxy Usage</strong> – Residential proxy data transfer costs</li>
<li><strong>Storage</strong> – Dataset storage duration and size</li>
</ul>

Typical consumption: **~0.01-0.05 compute units per 100 products** (without proxy)

## Support & Resources

<ul>
<li><strong>Documentation</strong> – <a href="https://docs.apify.com">Apify Documentation</a></li>
<li><strong>Community</strong> – <a href="https://discord.com/invite/jyEM2PRvMU">Apify Discord Server</a></li>
<li><strong>Issues</strong> – Report bugs or request features via GitHub</li>
</ul>

## Legal & Compliance

<ul>
<li>Scraping publicly available product data for personal or business intelligence purposes</li>
<li>Users responsible for compliance with Daraz.pk Terms of Service</li>
<li>Respect rate limits and avoid excessive requests</li>
<li>Do not scrape personal or sensitive information</li>
<li>Intended for legitimate market research and price monitoring</li>
</ul>

## Version History

<ul>
<li><strong>1.0.0</strong> – Initial release with dual extraction methodology</li>
</ul>

---

<p align="center">
<strong>Built for Apify Platform</strong><br>
<em>Professional web scraping and automation solutions</em>
</p>
