---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Pin all dependencies to exact versions.

Every external dependency across the workspace is now pinned to an exact version
(no `^`/`~` ranges), matching what was already installed in the lockfile. This
makes installs fully reproducible and removes silent range-drift. Dependabot is
configured to open weekly review-able PRs (grouped minor/patch, individual
majors) so new releases are a deliberate decision rather than an automatic pull.
