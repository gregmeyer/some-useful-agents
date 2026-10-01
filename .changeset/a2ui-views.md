---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agents can declare an A2UI view (schema and validation).

New agent field `view:`: an A2UI v0.9 component list bound to each run's data (`/outputs`, `/result`, `/inputs`, `/run`, `/history`), or `from: <node>` for a view a node writes at run time. Views are validated by the A2UI message processor in strict mode against the sua catalog (the A2UI basic components plus Metric, Badge, KeyValue, Table, Link, Code, SanitizedHtml), with size limits and image-host checks; an invalid declared view is refused at save. Drawing views in the dashboard comes next. Core now depends on `@a2ui/web_core` 0.12.0.
