---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

An experiment's notebook has a brief to print or send.

A notebook that shows an experiment had no **Download / share** menu (the menu was only offered once a notebook had options, and this kind has none). It now offers **The brief** as a page, a PDF or an HTML file. The brief ends with **How it was run**: what was run and how many times, what it was asked, each change with its versions and how results were scored, so it reads without the dashboard; its footer says the numbers are counted from the experiment's runs.
