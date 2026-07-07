---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox search now finds resolved and dismissed threads.

Searching the inbox only matched active threads — the default `list()` query
excludes terminal (dismissed/resolved) statuses, and that exclusion applied even
when a search query was present, so a thread you'd already resolved was
unfindable. Search now spans every status when a query is given (the default,
query-less view still hides terminal threads). An explicit `status=` filter
still scopes results to that status.
