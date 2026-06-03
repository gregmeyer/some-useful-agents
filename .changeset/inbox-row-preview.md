---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Show an always-visible one-line preview on every inbox row.

Each `/inbox` row now renders a clean one-line preview of the latest activity
(avatar + role + de-markdowned snippet via `markdownToText` + humanized dates)
directly under the title, so the inbox is skimmable without expanding each row.
The chevron still expands the full detail panel (proposed actions, context,
tags, Open-thread). Fixes raw Markdown (`**bold**`, `[x](/agents/y)`, ISO
timestamps) leaking into list previews.
