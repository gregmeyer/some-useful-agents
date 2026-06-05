---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox: bulk dismiss + better search, and live-updating direct threads.

- Select multiple inbox messages and dismiss them in one action, with improved
  search over the message list.
- Direct inbox threads now live-update as responses arrive, instead of needing a
  manual refresh.

(Restores work that lived only on an unmerged branch; landed onto main as part of
the inbox-branch consolidation.)
