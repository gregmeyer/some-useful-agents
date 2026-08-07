# web-scrape

Extract **structured data** from a web page — JSON-LD (schema.org: products, offers, prices, articles), page metadata (`<title>`, `og:*`, `<meta>`), and optionally the raw or browser-rendered HTML. The complement to [`web-fetch`](web-fetch.md):

- **`web-fetch`** → clean, readable **prose** (articles, docs, blog posts). Use when you want to *read* a page.
- **`web-scrape`** → machine-readable **data fields**. Use when you want specific values (a product price, an article's author/date, structured records).

It reuses the same HTTP + SSRF + optional-browser stack as `web-fetch`; only the extraction differs.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Absolute `http(s)` URL to scrape |
| `render` | string | no | Browser render: `auto` (default — render if HTTP yields no JSON-LD), `never`, `always` |
| `include_html` | boolean | no | Include the raw/rendered HTML in the result (capped). Default false |
| `max_html_chars` | number | no | Max HTML characters when `include_html` is set (default 50000) |

## Outputs

| Name | Type | Description |
|---|---|---|
| `url` | string | Final URL after redirects |
| `status` | number | HTTP status code (null if never fetched) |
| `method` | string | How it was retrieved: `http` or `browser` |
| `json_ld` | array | Parsed JSON-LD objects found on the page |
| `meta` | object | `<title>` + og/meta tags as a flat map |
| `html` | string | Raw/rendered HTML (null unless `include_html`) |
| `truncated` | boolean | True if `html` was cut to `max_html_chars` |
| `error` | string | Plain-English failure reason, or null on success |

`result` (node stdout) is the `json_ld` as JSON when present, else the `html`, else the `error` — so a downstream node/LLM gets the machine-readable payload directly. A page with no JSON-LD is a **success** (empty `json_ld`, `error: null`), not a failure.

## Retrieval strategy

1. **HTTP** — same hardened path as `web-fetch` (native fetch, per-hop SSRF re-validation, redirect/byte caps).
2. **Extraction** — parse the DOM with linkedom: collect every `<script type="application/ld+json">` block (arrays flattened, `@graph` kept, unparseable blocks skipped), plus `<title>` and all `<meta name|property>` → `content`.
3. **Browser (optional)** — under `render: auto`, escalate to headless Chromium **only when HTTP returned no JSON-LD** (SPAs commonly inject it via JS); `render: always` forces it, `never` disables it. Needs Playwright installed (`npx playwright install chromium`); degrades to the HTTP result otherwise.

## Example

```yaml
- id: product
  tool: web-scrape
  toolInputs:
    url: "https://store.example.com/shoe/trail-3000"
    render: auto
- id: decide
  type: llm-prompt
  dependsOn: [product]
  prompt: |
    From this product data, is it under $130? Return name + price.
    {{upstream.product.result}}
```

Example returned result (abridged):

```json
{
  "url": "https://store.example.com/shoe/trail-3000",
  "status": 200,
  "method": "http",
  "json_ld": [
    { "@type": "Product", "name": "Trail Shoe 3000",
      "offers": { "@type": "Offer", "price": "129.99", "priceCurrency": "USD" } }
  ],
  "meta": { "title": "Trail Shoe 3000", "og:title": "Trail Shoe 3000 — Store" },
  "html": null,
  "truncated": false,
  "error": null
}
```

## Safety

Identical guarantees to `web-fetch`: http/https only, private/loopback/metadata-IP blocking re-validated on every redirect hop, capped redirects/bytes, HTTP + browser timeouts, no form submission / login / CAPTCHA bypass. Never throws — failures return a structured result with a plain-English `error` and `json_ld: []`.

## Notes

- Direct core use: `import { webScrape } from '@some-useful-agents/core'`.
- Not every site exposes JSON-LD; when it doesn't, use `meta`, set `include_html: true` and parse the HTML downstream, or fall back to `web-fetch` for readable content.
