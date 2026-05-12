---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

dashboard: tabs on Settings → Integrations + Gmail setup guide

The integrations page is now tabbed by kind (All, Slack, Webhook, File,
Gmail) so the surface stays scannable as more kinds land. The active
tab is in the URL (`?tab=slack`), so deep links and form-error
redirects land on the right card.

The Gmail tab opens with a step-by-step setup guide pointing at
`console.cloud.google.com` (not `admin.google.com`, which is a
different surface that doesn't expose OAuth client creation), with
direct links to each console page: create project, enable Gmail API,
configure consent screen with the right scope, create the OAuth 2.0
Client ID with the redirect URI registered. Also explains why sua
asks the user to bring their own credentials (no embedded client →
no Google verification gate → trust-clean for an open-source tool).
