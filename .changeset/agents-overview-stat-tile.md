---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix: the Agents overview stat tile no longer contradicts the list filter.

The `AGENTS` / `N active` tile on `/agents` was computed from the status- and
search-filtered agent list, and it added every legacy v1 agent to the active
count unconditionally (v1 agents have no status). Filtering the list to a
non-active status therefore produced a nonsensical strip — e.g. filtering to
"paused" showed `AGENTS 5 / 1 active`, while `Total Runs` / `In Flight` in the
same strip stayed global. The overview strip now counts the whole tab
regardless of the list's status/search filters, so it stays a stable header.
