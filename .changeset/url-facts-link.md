---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook fact whose value is a web address is now a link.

Only link fields used to be clickable, so a text field holding an address, such as "Availability: https://…", showed as plain text. The option's page now links it, and a shortlist card shows it as a short link to the site ("target.com ↗").
