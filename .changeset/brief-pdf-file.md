---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's brief downloads as a real PDF file, ready to share.

Download / share → Download as PDF now gives a PDF named after the notebook, made by sua with a headless browser: no print dialog, no print time or dashboard address on every page, a footer with the title, date and page number, pictures inside it, white paper and a tighter layout (a shortlist of eight is three pages, not four). Links print their site, not their whole address. Without a browser installed it falls back to the print dialog. New `brief.pdf` route (`?full=1`, `?latest=1`, `?paper=a4`); core gains `htmlToPdf` and `htmlToPng`.
