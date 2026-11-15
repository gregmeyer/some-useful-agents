---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A brief's PDF stays small now that it carries pictures.

With sources' pictures in the brief, a PDF with six photos came out at 19 MB: a PDF keeps each picture at its full size, and stores a WebP as raw pixels. Before a PDF is made, each picture is now redrawn at the size it is shown (times three, so it stays sharp) as a JPEG. The same brief is 0.6 MB.
