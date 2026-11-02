# Daraz.pk API Discovery

Last verified: 2026-11-02. This file replaces the previous discovery notes. Every
row below comes from a live request made on that date from a clean Node process
with no cookies and no proxy.

Cloud check on 2026-11-02: builds 1.0.1 and 1.0.2 ran on Apify Cloud (Linux,
Node 22). The prefill input, empty input, URL-only input, and an empty query all
completed as expected. The keyword run saved 20 products with the `ios18`
profile.

## Read this first when a run fails

1. Reproduce the failing page with the profile named in the log.
2. Compare the response against the markers in [Response markers](#response-markers).
3. If the JSON shape changed, update `locateListItems()` in `src/daraz-client.js`.
4. Re-run the profile matrix before changing the profile pool.

The actor logs `hint=See API_DISCOVERY.md` on every unrecoverable response. That
hint means the response no longer matches any documented marker.

## Selected request

| Property          | Value                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Endpoint          | `https://www.daraz.pk/catalog/?q=<query>&ajax=true&page=<n>`                                                |
| Category form     | `https://www.daraz.pk/<category>/?ajax=true&page=<n>`                                                       |
| Method            | `GET`                                                                                                       |
| Auth              | None                                                                                                        |
| Cookies           | Not required                                                                                                |
| Proxy             | Not required                                                                                                |
| Response          | `application/json; charset=utf-8`                                                                           |
| Item array        | `mods.listItems`                                                                                            |
| Pagination        | `page`, `mainInfo.page`, `mainInfo.pageSize`, `mainInfo.totalResults`, `mainInfo.noMorePages`               |
| Best profile      | `ios18` (80 items per page)                                                                                 |
| Fallback profiles | `chrome151`, `chrome142`, `chrome136`, `firefox158`, `firefox144`, `okhttp5`, `okhttp4` (40 items per page) |

The desktop and mobile responses contain the same product fields. The mobile
response is not a reduced view. It returns twice as many items in one request,
so `ios18` is the primary profile and desktop profiles are fallbacks.

## Profile matrix

Probe URL: `https://www.daraz.pk/catalog/?q=dress&ajax=true&page=1`

| Impit profile                | Status | Items | `mainInfo.pageSize` | Decision             |
| ---------------------------- | -----: | ----: | ------------------: | -------------------- |
| `ios18`                      |    200 |    80 |                  80 | selected, primary    |
| `chrome151`                  |    200 |    40 |                  40 | selected, fallback   |
| `chrome142`                  |    200 |    40 |                  40 | selected, fallback   |
| `chrome136`                  |    200 |    40 |                  40 | selected, fallback   |
| `chrome100` to `chrome131`   |    200 |    40 |                  40 | verified, not pooled |
| `firefox158`                 |    200 |    40 |                  40 | selected, fallback   |
| `firefox144`                 |    200 |    40 |                  40 | selected, fallback   |
| `firefox128` to `firefox135` |    200 |    40 |                  40 | verified, not pooled |
| `okhttp5`                    |    200 |    40 |                  40 | selected, fallback   |
| `okhttp4`                    |    200 |    40 |                  40 | selected, fallback   |
| `okhttp`, `okhttp3`          |    200 |    40 |                  40 | verified, not pooled |

Every documented impit profile returned the catalog JSON. No profile was blocked
during discovery. Profile rotation exists for future edge blocks, not because a
profile is currently broken.

## Header strategies

Both strategies work with every pooled profile.

| Strategy  | Headers                                                                                                   | Purpose                                                         |
| --------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `profile` | None. Impit sends the profile's native browser headers.                                                   | Preferred first attempt.                                        |
| `ajax`    | `accept: application/json, text/plain, */*`, `x-requested-with: XMLHttpRequest`, `referer: <listing URL>` | Second attempt when a profile returns HTML or a challenge page. |

The actor never sets `user-agent`, `sec-ch-ua`, `accept-language`, or
`accept-encoding`. Those values belong to the impit profile and must stay
consistent with its TLS fingerprint.

## Pagination behavior

- `mainInfo.totalResults` scales with the profile. The same query returns `8160`
  under `ios18` and `4080` under desktop profiles.
- Both cases resolve to 102 pages (`8160 / 80` and `4080 / 40`).
- `mainInfo.noMorePages` is `true` on page 103 and later.
- Page 103 still returns a full item array even though `noMorePages` is `true`.
  Stop on the flag, not on the item count.
- A normal last page can return fewer items than `pageSize`.
- An empty result returns HTTP 200 with `totalResults: "0"`, an empty
  `mods.listItems`, and `noMorePages: true`. This is a valid empty result, not a
  block.

## Response markers

| Marker                                 | Meaning                                       | Action                               |
| -------------------------------------- | --------------------------------------------- | ------------------------------------ |
| JSON with `mods.listItems`             | Documented flow                               | Parse normally                       |
| JSON with `mainInfo.totalResults: "0"` | Valid empty result                            | Stop listing, keep run successful    |
| JSON with a different item array       | Shape drift                                   | Adapter logs the path used           |
| HTML (`text/html`)                     | Challenge, redirect, or `ajax` parameter lost | Rotate header strategy, then profile |
| Small JSON object without `mainInfo`   | Error envelope or blocked response            | Rotate profile                       |
| `FAIL_SYS_*` in a JSONP callback       | Mtop endpoint without a signed session        | Rejected candidate, do not retry     |

## Candidate matrix

| Candidate                                   |      Status | Result                                      | Decision                          |
| ------------------------------------------- | ----------: | ------------------------------------------- | --------------------------------- |
| `www.daraz.pk/catalog/?q=dress&ajax=true`   |         200 | 80 items, full fields                       | selected                          |
| `www.daraz.pk/<category>/?ajax=true`        |         200 | 80 items, category breadcrumb               | selected                          |
| `www.daraz.pk/catalog/?q=dress` (no `ajax`) |         200 | 17 KB React shell, no product data          | rejected as fallback              |
| `www.daraz.pk/search/?q=dress&ajax=true`    |         200 | HTML, not JSON                              | rejected                          |
| `m.daraz.pk`                                | DNS failure | Host does not exist                         | rejected                          |
| `acs-m.daraz.pk` mtop recommend API         |         200 | `FAIL_SYS_UNKNOWN_SESSION_TYPE`, empty data | rejected, requires signed session |
| `isFirstRequest=true` variant               |         200 | Reports `pageSize: 80` but returns 40 items | rejected, breaks offset math      |

## Fields used by the actor

Product fields are read from each `mods.listItems[]` object:

`itemId`, `nid`, `skuId`, `sku`, `name`, `description`, `brandName`, `brandId`,
`sellerName`, `sellerId`, `location`, `categories`, `price`, `priceShow`,
`originalPrice`, `originalPriceShow`, `discount`, `ratingScore`, `review`,
`itemSoldCntShow`, `image`, `thumbs`, `itemUrl`, `directSimilarUrl`, `inStock`,
`isSponsored`, `promotionId`, `icons`, `tItemType`, `cheapest_sku`, `clickTrace`,
`querystring`.

Page fields are read from `mainInfo`: `page`, `pageSize`, `totalResults`,
`noMorePages`, `RN`, `title`, `pageType`, `q`.

Unused internal fields such as `utLogMap`, `skus`, and `adFlag` stay out of the
dataset. `clickTrace` is only used to extract `shop_id`.

## Auto-healing rules implemented by the actor

| Failure                          | Actor response                                                     |
| -------------------------------- | ------------------------------------------------------------------ |
| Network error, timeout, HTTP 5xx | Retry the same page with backoff                                   |
| HTTP 429                         | Honor `Retry-After` (capped), rotate proxy session when configured |
| HTTP 403 or challenge HTML       | Rotate header strategy, then profile                               |
| HTTP 404 or other permanent 4xx  | Stop that listing, continue with the next one                      |
| JSON shape drift                 | Try documented adapters, log the path, keep the output contract    |
| Page size changes mid-listing    | Restart that listing once so offsets stay aligned                  |
| All retries exhausted on a page  | Stop that listing, keep saved batches, continue                    |
| No listing produced data         | Fail the run so the failure is visible                             |

Retry budget is four attempts per page with up to eight seconds of backoff. A
run never retries forever.

## Diagnostic commands

Run these from the actor root. They use the same impit version as the actor.

```bash
node --input-type=module -e "import { Impit } from 'impit'; const c = new Impit({ browser: 'ios18', timeout: 30000 }); const r = await c.fetch('https://www.daraz.pk/catalog/?q=dress&ajax=true&page=1'); const t = await r.text(); const j = JSON.parse(t); console.log(r.status, j.mainInfo?.pageSize, j.mods?.listItems?.length, Object.keys(j.mods || {}));"
```

```bash
node --input-type=module -e "import { Impit } from 'impit'; for (const b of ['ios18','chrome151','firefox158','okhttp5']) { const c = new Impit({ browser: b }); const r = await c.fetch('https://www.daraz.pk/catalog/?q=dress&ajax=true&page=1'); const j = await r.json().catch(() => ({})); console.log(b, r.status, j.mainInfo?.pageSize, j.mods?.listItems?.length); }"
```

Do not log cookies, authorization headers, or proxy URLs while diagnosing.
