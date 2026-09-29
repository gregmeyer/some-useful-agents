---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Start an agent from another service: inbound webhooks.

Turn on an agent's webhook (Config tab, or `sua agent webhook <agent> --on`) and anything that can POST (GitHub, Stripe, Zapier, a script) can run it at `/hooks/<agent>` with the agent's secret. JSON fields fill inputs of the same name; a new `webhook:` block maps payload paths, headers and query params to inputs, filters deliveries with `when:`, and can verify GitHub signatures. Only this path works through a tunnel; the rest of the dashboard stays local. Runs show as triggered by `webhook`. See docs/webhooks.md.
