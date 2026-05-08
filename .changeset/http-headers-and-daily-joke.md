---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Built-in `http-get` and `http-post` tools now accept an optional `headers` input. Many APIs (icanhazdadjoke, GitHub, anything content-negotiating) return HTML or text by default unless an explicit `Accept` header is sent — the tools used to ignore custom headers entirely, leaving agents to scrape HTML or fall back to a shell `curl` node. The new input is a `{name: value}` object passed through to `fetch`; for `http-post` the caller's headers are merged on top of the default `Content-Type: application/json` (and can override it).

Also fixes the `daily-joke` example agent: it was rendering the icanhazdadjoke HTML page on pulse because the default content type isn't JSON. Now sends `Accept: application/json` and `User-Agent: some-useful-agents` and gets the documented `{joke}` shape, which the format node parses cleanly.
