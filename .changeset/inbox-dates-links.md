---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Humanize timestamps and auto-link run/agent references in inbox messages.

Bare ISO timestamps in message prose (e.g. `2026-05-30T04:15:41.198Z`) now
render as `May 30, 2026 (3d ago)`, and bare `/runs/<id>` / `/agents/<id>`
references become clickable links. Both run as pre-passes before Markdown
rendering, so existing Markdown links and inline code are left intact.
