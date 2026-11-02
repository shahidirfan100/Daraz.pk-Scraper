## What does Daraz.pk Product Scraper do?

Daraz.pk Product Scraper collects product listing data from Daraz.pk category pages and search results. Give it a search keyword or a list of category URLs, and it returns a structured dataset with prices, discounts, ratings, reviews, seller details, stock state, images, and product links. Use it for price monitoring, catalog research, seller analysis, and recurring ecommerce reporting.

## Why use Daraz.pk Product Scraper?

- **Structured catalog data** - Turn public Daraz.pk listing pages into clean records you can filter, sort, and join with other data.
- **Keyword or URL input** - Start from a product search or from specific category pages, whichever fits the task.
- **Duplicate removal** - Products that appear on more than one page or listing are saved once.
- **Stock filtering** - Keep out-of-stock products out of the dataset, or include them when availability matters.
- **Export and integration options** - Download results as JSON, CSV, Excel, or XML, or connect the dataset to other tools through the Apify platform.
- **Repeatable runs** - Run once, or schedule the Actor to refresh the dataset on a daily or weekly basis.

## What data can you extract from Daraz.pk?

| Field           | Description                                     |
| --------------- | ----------------------------------------------- |
| `productId`     | Daraz.pk product identifier                     |
| `skuId`         | SKU identifier for the listed variant           |
| `title`         | Product title                                   |
| `description`   | Product description text                        |
| `brand`         | Brand name                                      |
| `sellerName`    | Seller or store name                            |
| `location`      | Seller location                                 |
| `price`         | Current price as a number                       |
| `priceText`     | Current price as shown on the page              |
| `originalPrice` | Original price before discount when available   |
| `discountPct`   | Discount percentage                             |
| `discountText`  | Discount label as shown on the page             |
| `rating`        | Product rating                                  |
| `reviewCount`   | Number of reviews                               |
| `soldCount`     | Units sold when the listing reports it          |
| `imageUrl`      | Primary product image URL                       |
| `productUrl`    | Product page URL                                |
| `inStock`       | Whether the product is in stock                 |
| `isSponsored`   | Whether the listing is sponsored                |
| `page`          | Listing page where the product was found        |
| `sourceUrl`     | Listing URL used for the run                    |
| `scrapedAt`     | ISO timestamp for when the record was collected |

The dataset also includes `sku`, `brandId`, `sellerId`, `shopId`, `categoryIds`, `descriptionBullets`, `originalPriceText`, `thumbnails`, `directSimilarUrl`, `promotionId`, `badgeTypes`, `badgeTexts`, `itemType`, `cheapestSku`, `searchTerm`, `requestId`, and `source`. Fields with no value on the source page are omitted from the record instead of saved as null.

## How to use Daraz.pk Product Scraper

1. Open the Actor on Apify Store.
2. Enter a search keyword, or add one or more Daraz.pk category URLs.
3. Set the product and page limits for the run.
4. Choose whether to include out-of-stock products.
5. Run the Actor and open the dataset.
6. Download the result or connect the dataset to your workflow.

## Input Parameters

| Parameter            | Type    | Required | Default | Description                                                                                                 |
| -------------------- | ------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `startUrls`          | Array   | No       | -       | Daraz.pk category or catalog listing URLs. When supplied, these are used and `searchQuery` is ignored.      |
| `searchQuery`        | String  | No       | `dress` | Product search keywords, used when no start URLs are supplied.                                              |
| `maxProducts`        | Integer | No       | `20`    | Maximum number of products to save. Set to `0` for unlimited.                                               |
| `maxPages`           | Integer | No       | `50`    | Maximum listing pages to request per URL or search query.                                                   |
| `includeOutOfStock`  | Boolean | No       | `false` | Include products that are currently out of stock.                                                           |
| `proxyConfiguration` | Object  | No       | `{}`    | Optional proxy settings. Leave empty to connect directly. Apify Proxy requires a run on the Apify platform. |

## Output Data

| Field                | Type    | Description                           |
| -------------------- | ------- | ------------------------------------- |
| `productId`          | String  | Product identifier                    |
| `skuId`              | String  | SKU identifier                        |
| `sku`                | String  | SKU code                              |
| `title`              | String  | Product title                         |
| `description`        | String  | Full description text                 |
| `descriptionBullets` | Array   | Description split into bullet strings |
| `brand`              | String  | Brand name                            |
| `brandId`            | String  | Brand identifier                      |
| `sellerName`         | String  | Seller or store name                  |
| `sellerId`           | String  | Seller identifier                     |
| `shopId`             | String  | Shop identifier                       |
| `location`           | String  | Seller location                       |
| `categoryIds`        | Array   | Category identifiers                  |
| `price`              | Number  | Current price                         |
| `priceText`          | String  | Current price as displayed            |
| `originalPrice`      | Number  | Original price                        |
| `originalPriceText`  | String  | Original price as displayed           |
| `discountPct`        | Number  | Discount percentage                   |
| `discountText`       | String  | Discount label                        |
| `rating`             | Number  | Product rating                        |
| `reviewCount`        | Number  | Review count                          |
| `soldCount`          | Number  | Units sold                            |
| `imageUrl`           | String  | Primary image URL                     |
| `thumbnails`         | Array   | Additional image URLs                 |
| `productUrl`         | String  | Product page URL                      |
| `directSimilarUrl`   | String  | Similar products URL                  |
| `inStock`            | Boolean | Stock state                           |
| `isSponsored`        | Boolean | Sponsored listing flag                |
| `promotionId`        | String  | Promotion identifier                  |
| `badgeTypes`         | Array   | Badge types attached to the listing   |
| `badgeTexts`         | Array   | Badge text attached to the listing    |
| `itemType`           | String  | Listing type                          |
| `cheapestSku`        | String  | Cheapest SKU for the product          |
| `searchTerm`         | String  | Search term reported by the listing   |
| `page`               | Number  | Listing page number                   |
| `sourceUrl`          | String  | Listing URL used for the run          |
| `requestId`          | String  | Request identifier                    |
| `source`             | String  | Data source label                     |
| `scrapedAt`          | String  | ISO timestamp                         |

## Usage Examples

### Search for products by keyword

Collect products for a keyword search:

```json
{
    "searchQuery": "iphone 15 pro max",
    "maxProducts": 50,
    "maxPages": 5
}
```

### Collect a category page

Collect products from a single Daraz.pk category:

```json
{
    "startUrls": ["https://www.daraz.pk/womens-fashion/"],
    "maxProducts": 40,
    "maxPages": 3
}
```

### Combine several categories

Collect products from more than one listing in a single run:

```json
{
    "startUrls": ["https://www.daraz.pk/mens-fashion/", "https://www.daraz.pk/electronic-devices/"],
    "maxProducts": 100,
    "includeOutOfStock": true
}
```

### Run with a proxy

Use proxy settings for larger or scheduled runs:

```json
{
    "searchQuery": "smart watch",
    "maxProducts": 200,
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"]
    }
}
```

## Sample Output

```json
{
    "productId": "1972630211",
    "skuId": "14061721546",
    "sku": "1972630211_PK",
    "title": "Soft and Comfortable Full Sleeve T-shirt paired with Flapper Trouser Combo for Women and Girls",
    "description": "Soft and Comfortable Fabric: Crafted from high-quality materials to ensure a cozy feel against the skin.",
    "descriptionBullets": [
        "Soft and Comfortable Fabric: Crafted from high-quality materials to ensure a cozy feel against the skin."
    ],
    "brand": "No Brand",
    "brandId": "39704",
    "sellerName": "creative purchase",
    "sellerId": "1112873",
    "shopId": "223115",
    "location": "Sindh",
    "categoryIds": ["1819", "1820", "1738", "10001963"],
    "price": 999,
    "priceText": "Rs. 999",
    "originalPrice": 1999,
    "discountText": "50% Off",
    "discountPct": 50,
    "reviewCount": 0,
    "soldCount": 1,
    "imageUrl": "https://static-01.daraz.pk/p/8a92a1d5542ba6cf250da1e9f4ca80ec.jpg",
    "productUrl": "https://www.daraz.pk/products/soft-and-comfortable-full-sleeve-t-shirt-paired-with-flapper-trouser-combo-for-women-and-girls-i1972630211.html",
    "inStock": true,
    "isSponsored": false,
    "badgeTypes": ["FreeshippingAndVoucherMax"],
    "itemType": "nt_product",
    "cheapestSku": "1972630211_PK-14061721546",
    "searchTerm": "dress",
    "page": 1,
    "sourceUrl": "https://www.daraz.pk/catalog/?q=dress",
    "requestId": "5cd823c9fb503e251bc8a1ecd5343260",
    "source": "daraz.pk",
    "scrapedAt": "2026-11-02T09:56:17.999Z"
}
```

## Tips for Best Results

- Start with a focused category or a specific keyword. Broad categories produce a mixed dataset and fill the product limit quickly.
- Keep `maxProducts` low for a first run, then raise it after you check the output.
- Use category URLs that show products in a normal browser session. A category that is empty or unavailable returns an empty dataset.
- Leave `startUrls` empty when you want to use `searchQuery`. When both are set, `startUrls` wins.
- Use `maxProducts: 0` only when you need the full result set. It removes the product cap, not the page cap.
- Enable a proxy for large or scheduled runs. Direct connections work for small runs.
- Public listing pages change over time. If a field disappears, check a few records before assuming the Actor failed.

## Integrations

- **Google Sheets** - Send product records to a spreadsheet for price and rating analysis.
- **Webhooks** - Trigger a downstream workflow when a run finishes.
- **Make or Zapier** - Connect results to no-code automations.
- **API** - Read the dataset from your own systems with the Apify API.
- **Scheduled runs** - Refresh the dataset on a daily, weekly, or custom schedule.

### Export Formats

- **JSON** - For applications and data pipelines.
- **CSV** - For spreadsheets and quick review.
- **Excel** - For business reporting.
- **XML** - For systems that require XML input.

## Frequently Asked Questions

### Which input is used first, `startUrls` or `searchQuery`?

`startUrls` is used first. When it contains at least one valid Daraz.pk listing URL, `searchQuery` is ignored for that run.

### What happens if I run the Actor with no input?

The run uses the default search query `dress` and saves up to 20 products. This keeps the Actor testable from the Apify Console without any setup.

### Can I collect more than 20 products?

Yes. Raise `maxProducts` to the number you need, or set it to `0` for no product limit. `maxPages` still controls how many listing pages the run requests.

### Can I export Daraz.pk product data to CSV or Excel?

Yes. Apify datasets can be downloaded as CSV, Excel, JSON, XML, and other supported formats from the Console or through the API.

### Can I run this Actor on a schedule?

Yes. Schedule the Actor in Apify Console to refresh prices, stock, and ratings on a daily, weekly, or custom interval.

### Why is my dataset smaller than the limit I set?

The final count can be lower because of duplicate removal, out-of-stock filtering, the page limit, or a listing that ran out of products. The run log reports saved, duplicate, and filtered counts.

### Can I include out-of-stock products?

Yes. Set `includeOutOfStock` to `true`.

### Why are some fields missing from a record?

Daraz.pk does not publish every field for every listing. When a value is absent, the Actor leaves that field out of the record instead of saving a null value.

### Is it legal to scrape Daraz.pk?

Scraping public data can be legal, but you are responsible for complying with applicable laws, website terms, and privacy rules. Use the data responsibly and avoid collecting personal information you do not need.

## Support

For issues or feature requests, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is designed for legitimate collection of publicly available product data. Users are responsible for how they use the data and for complying with applicable laws and website terms.
