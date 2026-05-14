---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Dashboard widget extractor now recovers a trailing JSON object embedded inside human prose. claude-code summarisers commonly emit a human-readable narrative followed by a final `{…}` line that drives the widget — the prior extractor only handled pure-JSON output or XML tags, so the widget rendered empty for any agent that produced both kinds of output.

`extractField()` is now exported from `views/output-widgets.ts` and unit-tested. The recovery strategy walks `{` positions from rightmost to leftmost and slices to the last `}`, preferring the smallest trailing object so we don't accidentally engulf earlier prose that contains brace characters.
