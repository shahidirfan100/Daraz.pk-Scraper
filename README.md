# Daraz.pk Product Scraper

Extract comprehensive product listing data from Daraz.pk at scale. Collect pricing, ratings, stock status, seller details, images, and product links in a structured dataset. Built for market research, catalog monitoring, and e-commerce intelligence workflows.

## Features

- **Flexible start modes** — Scrape with multiple listing URLs or a search query
- **Rich product fields** — Collect IDs, titles, prices, discounts, reviews, ratings, seller data, and media links
- **Pagination controls** — Limit pages and result volume for fast QA-safe runs
- **Deduplicated output** — Prevent duplicate product records across pages and URLs
- **Structured exports** — Use JSON, CSV, Excel, XML, and API dataset endpoints

## Use Cases

### Price Monitoring
Track current and historical pricing patterns across Daraz categories. Detect discount opportunities and monitor competitor price movement.

### Product Research
Build large product datasets with ratings, reviews, and stock status. Compare brand and seller performance before sourcing decisions.

### Seller Intelligence
Analyze seller coverage, product assortment, and listing quality signals. Identify top-performing stores by category and product type.

### Trend Tracking
Run scheduled extractions to monitor how catalog availability changes over time. Spot demand shifts by observing stock and review growth.

### BI and Reporting
Feed clean product data into dashboards, spreadsheets, and analytics pipelines. Support recurring reporting without manual collection.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrls` | String[] | No | `["https://www.daraz.pk/womens-fashion/"]` | List of listing URLs. If provided, this is used first. |
| `searchQuery` | String | No | `""` | Search keywords. Used when `startUrls` is empty. |
| `maxProducts` | Integer | No | `20` | Maximum products to save. Use `0` for unlimited. |
| `maxPages` | Integer | No | `50` | Maximum listing pages to process per URL. |
| `includeOutOfStock` | Boolean | No | `false` | Include products that are currently out of stock. |
| `proxyConfiguration` | Object | No | `{ "useApifyProxy": false }` | Optional proxy settings for higher reliability. |

---

## Output Data

Each dataset item contains:

| Field | Type | Description |
|-------|------|-------------|
| `productId` | String | Product identifier |
| `skuId` | String | SKU identifier |
| `title` | String | Product title |
| `brand` | String | Brand name |
| `sellerName` | String | Seller/store name |
| `location` | String | Product location |
| `price` | Number | Current numeric price |
| `originalPrice` | Number | Original numeric price when available |
| `discountPct` | Number | Discount percentage |
| `rating` | Number | Product rating |
| `reviewCount` | Number | Number of reviews |
| `soldCount` | Number | Estimated sold count |
| `imageUrl` | String | Primary image URL |
| `productUrl` | String | Product page URL |
| `inStock` | Boolean | Product stock state |
| `isSponsored` | Boolean | Sponsored listing flag |
| `page` | Number | Listing page number |
| `sourceUrl` | String | Source listing URL |
| `requestId` | String | Source request identifier |
| `scrapedAt` | String | ISO timestamp of extraction |

---

## Usage Examples

### Basic Category Extraction

Collect products from a single listing URL:

```json
{
  "startUrls": ["https://www.daraz.pk/womens-fashion/"],
  "maxProducts": 20,
  "maxPages": 3
}
```

### Search-Based Extraction

Collect products for a keyword query:

```json
{
  "searchQuery": "iphone 15 pro max",
  "maxProducts": 30,
  "maxPages": 4
}
```

### Multiple URL Extraction

Collect products from multiple listing URLs in one run:

```json
{
  "startUrls": [
    "https://www.daraz.pk/mens-fashion/",
    "https://www.daraz.pk/electronic-devices/"
  ],
  "maxProducts": 60,
  "includeOutOfStock": true
}
```

### Proxy Configuration

For more stable collection on larger runs:

```json
{
  "startUrls": ["https://www.daraz.pk/womens-fashion/"],
  "maxProducts": 40,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

---

## Sample Output

```json
{
  "productId": "453338509",
  "skuId": "1728453521",
  "title": "Apple iPhone 15 Pro Max",
  "brand": "Apple",
  "sellerName": "Official Store",
  "location": "Lahore",
  "price": 334999,
  "originalPrice": 349999,
  "discountPct": 4,
  "rating": 4.8,
  "reviewCount": 127,
  "soldCount": 300,
  "imageUrl": "https://static-01.daraz.pk/p/example.jpg",
  "productUrl": "https://www.daraz.pk/products/example",
  "inStock": true,
  "isSponsored": false,
  "page": 1,
  "sourceUrl": "https://www.daraz.pk/womens-fashion/",
  "requestId": "abc123",
  "scrapedAt": "2026-03-07T00:00:00.000Z"
}
```

---

## Tips for Best Results

### Use Stable Listing URLs
- Start with valid category URLs that return visible products
- Use one URL per line for `startUrls`
- Prefer focused categories for cleaner datasets

### Keep QA Runs Fast
- Use `maxProducts: 20` for quick verification
- Keep `maxPages` low during test runs
- Increase limits only after validating output quality

### Improve Reliability
- Enable proxy usage for larger or scheduled runs
- Retry with smaller runs when a category is temporarily unstable
- Run multiple targeted jobs instead of one oversized crawl

---

## Integrations

Connect your data with:

- **Google Sheets** — Analyze prices and ratings in spreadsheets
- **Airtable** — Build searchable product tracking bases
- **Make** — Trigger automated workflows from new dataset items
- **Zapier** — Send product updates to business apps
- **Webhooks** — Push records to your own API pipeline

### Export Formats

- **JSON** — For APIs and engineering workflows
- **CSV** — For spreadsheet analysis
- **Excel** — For business reporting
- **XML** — For legacy integrations

---

## Frequently Asked Questions

### Which input is used first?
`startUrls` is used first. If `startUrls` is empty, `searchQuery` is used.

### What happens if I run with no input?
The actor uses default values, and local QA runs can fall back to `INPUT.json` defaults.

### Can I collect unlimited products?
Yes. Set `maxProducts` to `0` to remove the product limit.

### Why is my dataset smaller than expected?
Limits from `maxProducts`, `maxPages`, duplicate removal, and stock filtering can reduce final count.

### Can I include out-of-stock products?
Yes. Set `includeOutOfStock` to `true`.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Apify Scheduling](https://docs.apify.com/platform/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. You are responsible for complying with website terms, local regulations, and applicable data usage laws.
