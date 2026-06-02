---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add CTA affordances to inbox triage replies.

Triage can now attach an optional `ctaLabel` to a proposed action (so the
dispatch button reads "Describe this agent" instead of the generic "Run") and
an optional `links` array to its plan, rendered as link-CTA buttons under the
reply. Link hrefs are validated against the sanitizer's URL allowlist (relative
or http(s)/mailto only). Dispatch CTAs reuse the existing action pipeline, so
they still run and update the conversation inline without a refresh.
