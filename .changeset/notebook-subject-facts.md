---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notebooks learn about who they're about: a profile step, with their facts, photo and company logo.

A new step kind, **profile** ("Learn about Dana Reyes"), has sua's researcher look up the person a notebook prepares you to meet, then their company (or a company alone): role, company, location, background, what they're known for, links, and the company's work, size, stage, founding and news, each fact kept with its source. sua keeps a copy of their photo and the company's logo, and the notebook's header shows the photo. Pages bind them as `/notebook/person`, `/notebook/company`, `/notebook/facts` and `/notebook/notFound` for ProfileCard and FactSheet, with a new `about` flag. When sua sets up a notebook that prepares you to meet someone, it puts a profile step first, and a notebook drawing its page leads with who they are.
