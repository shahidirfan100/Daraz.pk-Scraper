## Selected API

- Endpoint: `https://www.daraz.pk/catalog/?q=<query>&ajax=true&page=<n>`
- Category variant: `https://www.daraz.pk/<category-path>/?ajax=true&page=<n>`
- Method: `GET`
- Auth: None
- Pagination: `page=<n>` with `mainInfo.page`, `mainInfo.pageSize`, `mainInfo.totalResults`, and `mainInfo.noMorePages`
- Fields available:
  - `mods.listItems[].itemId`
  - `mods.listItems[].skuId`
  - `mods.listItems[].sku`
  - `mods.listItems[].name`
  - `mods.listItems[].description[]`
  - `mods.listItems[].image`
  - `mods.listItems[].thumbs[]`
  - `mods.listItems[].price`
  - `mods.listItems[].priceShow`
  - `mods.listItems[].originalPrice`
  - `mods.listItems[].originalPriceShow`
  - `mods.listItems[].discount`
  - `mods.listItems[].ratingScore`
  - `mods.listItems[].review`
  - `mods.listItems[].itemSoldCntShow`
  - `mods.listItems[].location`
  - `mods.listItems[].sellerName`
  - `mods.listItems[].sellerId`
  - `mods.listItems[].brandName`
  - `mods.listItems[].brandId`
  - `mods.listItems[].categories[]`
  - `mods.listItems[].icons[]`
  - `mods.listItems[].promotionId`
  - `mods.listItems[].itemUrl`
  - `mods.listItems[].directSimilarUrl`
  - `mods.listItems[].querystring`
  - `mods.listItems[].inStock`
  - `mods.listItems[].isSponsored`
  - `mods.listItems[].utLogMap`
  - `mods.listItems[].clickTrace`
  - `mainInfo.totalResults`
  - `mainInfo.pageSize`
  - `mainInfo.page`
  - `mainInfo.noMorePages`
  - `mainInfo.RN`
- Fields currently missing in the actor:
  - `skuId`
  - `sku`
  - `sellerId`
  - `shopId` from `clickTrace`
  - `brandId`
  - `descriptionBullets`
  - `badgeTypes`
  - `badgeTexts`
  - `soldCount`
  - `categoryIds`
  - `thumbnails`
  - `directSimilarUrl`
  - `requestId`
  - `searchTerm`
  - `page`
  - `sourceUrl`
  - `isSponsored`
  - `promotionId`
- Field count: 35+ unique fields available from the listing payload vs roughly 16 normalized fields in the previous actor output

## API Score

- Returns JSON directly: +30
- Has more than 15 unique fields: +25
- No auth required: +20
- Has pagination support: +15
- Matches and extends current fields: +10
- Total: 100

## Decision

The catalog AJAX endpoint is sufficient for a pure HTTP actor. It returns stable listing data, full pagination metadata, and significantly richer product metadata than the previous normalized output, so Playwright is not required.
