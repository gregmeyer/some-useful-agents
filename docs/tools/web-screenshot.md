# web-screenshot

Take a **picture of a web page** as a browser shows it, and keep it with the run. Use it as proof of what a page said on the day, or when a page's text can't be read (an image-heavy page, a chart, a layout). To read a page's text, use [`web-fetch`](web-fetch.md).

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Absolute `http(s)` URL of the page |
| `full_page` | boolean | no | The whole page (`true`, cut at 8000px tall) or just the first screen (`false`, the default) |
| `width` | number | no | Browser width in px, 320–1920 (default 1280) |
| `timeout` | number | no | Timeout in seconds (default 30) |

## Outputs

| Name | Type | Description |
|---|---|---|
| `url` | string | Final URL after redirects |
| `title` | string | Page title |
| `file` | string | The picture's name with the run (`<node>-<n>.png`) |
| `path` | string | Where the picture is on disk |
| `width`, `height` | number | Picture size, px |
| `status` | number | HTTP status of the page |
| `error` | string | Plain-English failure reason, or null on success |

`result` says what was taken and where it's kept: `Took a screenshot of https://… ("Title"): 1280×900px, kept with the run as research-1.png (/runs/<id>/files/research-1.png).`

## Where it's kept

Each picture is a PNG in `<data dir>/run-files/<run id>/`, named for the node that took it. The run page shows a node's screenshots under its card (**Screenshots**), each opening full size; by address, `/runs/<id>/files/<name>` (signed in). A tool call outside a run (nowhere to keep it) says so and takes nothing.

Today the model gets the text result only; it doesn't see the picture itself yet.

## Safety

- Every request the page makes is checked against private, loopback, link-local and cloud-metadata addresses (not only the first URL), so a redirect or a script on the page can't reach your network.
- Tool policies match it by its `url`, like `web-fetch` ([tool-policies.md](../tool-policies.md)).

## Needs a browser

It uses Playwright's headless Chromium, an optional dependency. Without it the tool says so and takes nothing; install it with:

```bash
npx playwright install chromium
```

## Example

```yaml
nodes:
  - id: research
    type: llm-prompt
    tools: [web-fetch, web-screenshot]
    prompt: |
      Read {{inputs.URL}}. If its text is thin or missing, take a screenshot of it as proof.
```
