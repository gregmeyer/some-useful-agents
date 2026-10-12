---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's shortlist can be filtered.

- **What you can filter by:** listing (current vs not seen lately), stage, and any text fact the options differ on, such as seller or location.
- **How it works:** each filter is a row of chips counting what picking it would show. Filters combine, ranks stay those of the whole list, and your choice is remembered per notebook in this browser.
- **For other views:** the OptionGrid widget takes a new `filters` setting, a list of field keys or `stage` / `seen`, so boards and agent views can declare their own.
