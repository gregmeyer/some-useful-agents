---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Report codex failures by their real cause, and fall back when a provider rejects its model.

codex reports a failed turn as a JSON `turn.failed` event, but sua classified failures from stderr, where codex also logs unrelated noise such as an MCP server's expired token. A codex pinned to a model the account no longer supports ("The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account") showed up as `auth_required`, and without the noise it would have been `other`, which stops the waterfall and fails the node. sua now reads codex's own error message, and a rejected model is a new fallback-worthy `model_unavailable` category, so the next provider answers and the node card says why codex was skipped.
