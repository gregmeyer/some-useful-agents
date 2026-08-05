---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix: `loop` nodes now iterate over a shell node's unframed (pretty-printed) JSON.

A `loop` whose upstream was a shell node emitting multi-line JSON — e.g. the
default output of `jq -n '{queries: [...]}'` — failed setup with
`Loop field "<over>" on upstream "<id>" is not an array`, even though the
stdout plainly contained the array. The output-framing protocol only parses
the *last* stdout line as structured output, so multi-line JSON left the array
buried inside `outputs.result` as a string and unreachable by the loop's
`over` path. `resolveLoop` now falls back to parsing the upstream's raw stdout
as JSON when the structured-outputs lookup doesn't yield an array, so loops
work regardless of whether the upstream shell node compact-prints its JSON.
