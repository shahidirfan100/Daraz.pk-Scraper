# Daraz.pk API Discovery

Last verified: 2026-11-04. This file replaces the previous discovery notes. Every
row below comes from a live request made from a clean Node process with no
cookies and no proxy.

## 2026-11-04 additions

Three failure modes were reproduced against the live endpoint. All three are now
handled by the actor.

| Symptom                                    | Evidence                                                                                                                                                                                   | Handling                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Invalid listing path returns HTTP 200 HTML | `GET /mobiles/?ajax=true&page=1` → 200, 99 KB error page. `wh_pid=/lazada/channel/pk/common/error` appears in `meta[name=page-url]`                                                        | Classified as `not-found`, then paginated as `/catalog/?q=<slug>`                            |
| Anti-bot challenge returns HTTP 200 HTML   | Repeated bursts produced a 1.5 KB script redirect to `/_____tmd_____/punish?x5secdata=...`. Every impit profile and native `fetch` received it                                             | Classified as `punish`, three spaced retries, proxy rotation, then one cooled-down run retry |
| Category pagination can repeat a page      | A CDN edge served the same 80 `itemId`s on pages 1, 3 and 5 during a burst. The same happens on Apify Cloud for the category route, while `/catalog/?q=` paginates normally on the same IP | Switch that listing to `/catalog/?q=<slug>` after the first page with no new items           |

The challenge is IP-based: rotating the impit profile did not clear it, and a
plain `fetch` from the same host received the same page. Only a different IP
(proxy) or time clears it. The actor therefore rotates Apify Proxy sessions when
a proxy is configured and otherwise fails with an explicit instruction to
enable one.

### Valid listing URL forms

| Form                                                                  | Result                               |
| --------------------------------------------------------------------- | ------------------------------------ |
| `/catalog/?q=<query>`                                                 | JSON, works for any query            |
| `/<real-category-slug>/`, e.g. `/womens-dresses/` or `/mens-fashion/` | JSON, 80 items per page with `ios18` |
| `/<wrong-or-guessed-slug>/`, e.g. `/mobiles/`                         | `common/error` HTML page             |
| `/catalog/<slug>/`                                                    | React shell HTML, no products        |
| `/` (homepage) or `/products/...`                                     | Rejected as input, not a listing     |

Cloud check on 2026-11-02: builds 1.0.1 and 1.0.2 ran on Apify Cloud (Linux,
Node 22). The prefill input, empty input, URL-only input, and an empty query all
completed as expected. The keyword run saved 20 products with the `ios18`
profile.

## Read this first when a run fails

1. Reproduce the failing page with the profile named in the log.
2. Compare the response against the markers in [Response markers](#response-markers).
3. If the JSON shape changed, update `locateListItems()` in `src/daraz-client.js`.
4. Re-run the profile matrix before changing the profile pool.

Every unrecoverable response is logged with its `marker` and `code`. If the
marker is not in [Response markers](#response-markers), the response no longer
matches any documented shape. If the marker is `punish`, the IP is blocked and
no code change will help - use a proxy.

## Selected request

| Property          | Value                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Endpoint          | `https://www.daraz.pk/catalog/?q=<query>&ajax=true&page=<n>`                                                |
| Category form     | `https://www.daraz.pk/<real-category-slug>/?ajax=true&page=<n>`                                             |
| Method            | `GET`                                                                                                       |
| Auth              | None                                                                                                        |
| Cookies           | Not required                                                                                                |
| Proxy             | Optional. Required to recover from an IP-level `punish` block.                                              |
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
- The `/catalog/?q=` route paginated cleanly on every test, including five
  consecutive pages from an Apify Cloud container with no proxy.
- The category route (`/<slug>/?ajax=true`) is served through an edge cache that
  intermittently replays the same item array for different `page` values. When
  that happens the actor switches that listing to `/catalog/?q=<slug>`, which
  paginates correctly.

## Response markers

| Marker                                           | Meaning                                       | Action                                                      |
| ------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------- |
| JSON with `mods.listItems`                       | Documented flow                               | Parse normally                                              |
| JSON with `mainInfo.totalResults: "0"`           | Valid empty result                            | Stop listing, keep run successful                           |
| JSON with a different item array                 | Shape drift                                   | Adapter logs the path used                                  |
| HTML with `/lazada/channel/pk/common/error`      | Listing path does not exist                   | No retry; try `/catalog/?q=<slug>`                          |
| HTML with `/_____tmd_____/punish` or `x5secdata` | Anti-bot challenge for this IP                | Spaced retries, rotate proxy, cool down                     |
| HTML (`text/html`)                               | Challenge, redirect, or `ajax` parameter lost | Retry with the other header strategy, then the next profile |
| Small JSON object without `mainInfo`             | Error envelope or blocked response            | Rotate profile                                              |
| Empty array without page metadata                | Error envelope, not a valid empty result      | Rotate profile                                              |
| `FAIL_SYS_*` in a JSONP callback                 | Mtop endpoint without a signed session        | Rejected candidate, do not retry                            |

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
| Network error, timeout, HTTP 5xx | Retry the same page with capped exponential backoff and jitter     |
| HTTP 429                         | Honor `Retry-After` (capped), rotate proxy session when configured |
| HTTP 403 or challenge HTML       | Rotate header strategy, then profile, then proxy session           |
| Anti-bot punish page             | Three spaced attempts (10 s, 25 s), then one cooled-down run retry |
| Invalid listing path             | Switch to `/catalog/?q=<derived slug>` and paginate normally       |
| Homepage or product page as URL  | Rejected before any request with a clear input error               |
| HTTP 404 or other permanent 4xx  | Stop that listing, continue with the next one                      |
| JSON shape drift                 | Try documented adapters, log the path, keep the output contract    |
| Page size changes mid-listing    | Translate the page number to the new size instead of restarting    |
| Category page replays old items  | Switch that listing to `/catalog/?q=<slug>`, keep deduplicating    |
| Same products after the switch   | Stop that listing after three stalled pages                        |
| Broken custom proxy URL          | Drop the proxy, log a warning, continue directly                   |
| Malformed single product         | Skip it, count it as invalid, keep the rest of the batch           |
| All retries exhausted on a page  | Stop that listing, keep saved batches, continue                    |
| No listing produced data         | Retry the whole run once, then fail with an actionable message     |

Retry budget is eight attempts per page for ordinary failures, with a 45-second
total wait cap and up to eight seconds per backoff step. Anti-bot challenges get
three attempts instead because retrying a punish page in a tight loop only
extends the block. A run never retries forever: each listing also has a request
budget of twice `maxPages` (500 when unlimited).

## Diagnostic commands

Run these from the actor root. They use the same impit version as the actor.

```bash
node --input-type=module -e "import { Impit } from 'impit'; const c = new Impit({ browser: 'ios18', timeout: 30000 }); const r = await c.fetch('https://www.daraz.pk/catalog/?q=dress&ajax=true&page=1'); const t = await r.text(); const j = JSON.parse(t); console.log(r.status, j.mainInfo?.pageSize, j.mods?.listItems?.length, Object.keys(j.mods || {}));"
```

```bash
node --input-type=module -e "import { Impit } from 'impit'; for (const b of ['ios18','chrome151','firefox158','okhttp5']) { const c = new Impit({ browser: b }); const r = await c.fetch('https://www.daraz.pk/catalog/?q=dress&ajax=true&page=1'); const j = await r.json().catch(() => ({})); console.log(b, r.status, j.mainInfo?.pageSize, j.mods?.listItems?.length); }"
```

Do not log cookies, authorization headers, or proxy URLs while diagnosing.
