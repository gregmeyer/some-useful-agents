---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Let inbox triage answer catalog questions directly.

The triage agent now receives a trimmed installed-agent catalog (newest first,
with descriptions and install dates) on its own turn, so questions like "what's
the newest agent and what does it do?" are answered immediately — named,
described, dated in human form, and linked to `/agents/<id>` — instead of
dispatching a catalog-search round-trip and hedging. The prompt also instructs
triage to write Markdown, link runs/agents, humanize dates, and offer link CTAs.
Genuine capability/topic search still dispatches agent-catalog-search (with the
full catalog).
