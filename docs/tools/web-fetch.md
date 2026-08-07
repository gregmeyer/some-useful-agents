# web-fetch

Fetch a public web page and return **clean, readable text** optimized for an LLM — not raw HTML. The tool owns all the complexity (HTTP, redirects, content-type handling, HTML cleanup, and an optional headless browser); a node (or agent author) only supplies a URL.

Use `web-fetch` when an agent needs to **read the contents of a public web page** (articles, docs, news, blog posts, wikis, forum threads, release notes). It is not a structured-scraping API — for JS-rendered product grids or extracting specific fields (prices, tables of records), see [Limitations](#limitations).

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Absolute `http(s)` URL of the page to read |
| `max_chars` | number | no | Max characters of content to return (default 30000) |
| `timeout` | number | no | Per-attempt timeout in seconds (default 20) |
| `browser` | string | no | Browser fallback: `auto` (default), `never`, or `always` |

## Outputs

| Name | Type | Description |
|---|---|---|
| `url` | string | Final URL after redirects |
| `title` | string | Page title (null if unavailable) |
| `content` | string | Clean Markdown/plaintext content (null on failure) |
| `method` | string | How it was retrieved: `http` or `browser` |
| `status` | number | HTTP status code (null if never fetched) |
| `truncated` | boolean | True if content was cut to `max_chars` |
| `error` | string | Plain-English failure reason, or null on success |

`result` (the node's stdout) is the cleaned `content`, or the `error` string on failure — so a downstream text consumer or small model always sees something meaningful.

## Retrieval strategy (progressive escalation)

1. **HTTP** — native `fetch` with a browser-like User-Agent, manual redirects (each hop re-validated for SSRF), content-type gating (text/HTML/XML only), and a 2 MB byte cap.
2. **Extraction** — [Readability](https://github.com/mozilla/readability) isolates the main article (dropping nav, scripts, styles, cookie banners, menus, boilerplate); [Turndown](https://github.com/mixmark-io/turndown) converts it to Markdown (headings, lists, links, table cell text). Falls back to collapsed plaintext when there's no clear article.
3. **Browser (optional)** — only when HTTP yields too little (`browser: auto`) or when forced (`browser: always`). Renders the page with headless Chromium via **Playwright**, then runs the rendered HTML back through the same extraction.

The browser step uses Playwright, an **optional dependency**. If it isn't installed the tool stays HTTP-only and says so; enable it with:

```bash
npm i playwright && npx playwright install chromium
```

## Example

```yaml
- id: read_article
  tool: web-fetch
  toolInputs:
    url: "https://example.com/blog/post"
    max_chars: 20000
- id: summarize
  type: llm-prompt
  dependsOn: [read_article]
  prompt: |
    Summarize this article in 3 bullets:
    {{upstream.read_article.content}}
```

Example returned result:

```json
{
  "url": "https://example.com/blog/post",
  "title": "How we built X",
  "content": "## How we built X\n\nWe started by…",
  "method": "http",
  "status": 200,
  "truncated": false,
  "error": null
}
```

A structured failure (never a raw exception):

```json
{
  "url": "https://example.com/secret",
  "title": null,
  "content": null,
  "method": "http",
  "status": 403,
  "truncated": false,
  "error": "The server denied access to this page."
}
```

## Safety

- Only `http://` and `https://` URLs.
- **SSRF protection** — reuses core's `assertSafeUrl` (rejects private/loopback/link-local/cloud-metadata IPs), re-validated on **every redirect hop**.
- Capped redirects (≤5), capped download bytes (2 MB), capped extracted characters (`max_chars`), HTTP + browser timeouts.
- Does not submit forms, log in, solve CAPTCHAs, or attempt to bypass access controls; respects the server's response (a 403/429 is reported, not worked around).

## Limitations

- Returns **readable content**, not the raw DOM or structured fields. For JS-rendered **product grids** or extracting specific structured records (prices, JSON-LD, tables of data), readable-content extraction is the wrong fit even with the browser fallback — that calls for a separate structured-scrape capability.
- The browser fallback needs Playwright + Chromium installed (see above); without it, JS-only pages return a thin result with a clear `error`/`method: http`.
- Direct core use (independent of the tool layer): `import { webFetch } from '@some-useful-agents/core'`.
