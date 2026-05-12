---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

ci: gitleaks secret-scan on push + PR

Adds `.github/workflows/secret-scan.yml` running gitleaks on every
push + pull request. Catches secret-shaped strings (`xoxb-…`,
`ghp_…`, `AIza…`, base64 RSA keys, …) before they hit main on a
public repo. Config in `.gitleaks.toml` extends the upstream default
ruleset and allowlists test fixtures that intentionally hold
secret-shaped strings (redactor self-tests, env-builder fixtures,
ADR examples).

`scripts/install-hooks.sh` is an opt-in local pre-commit hook that
runs the same scan against staged changes so leaks die at commit
time rather than after a force-push. Not auto-installed by
`npm install` — explicit by design. Documented in docs/SECURITY.md.
