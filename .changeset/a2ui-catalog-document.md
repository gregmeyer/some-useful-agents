---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

The sua component catalog is published as an A2UI 1.0 catalog document.

`suaCatalogDocument()` writes the whole catalog (A2UI's basic components and functions, plus every sua component with its props, a description and an example) as A2UI 1.0 catalog JSON, and the dashboard serves it at `/a2ui/catalogs/sua/v1.json`, where its catalog id points. A2UI's own loader reads it back and validates surfaces against it.
