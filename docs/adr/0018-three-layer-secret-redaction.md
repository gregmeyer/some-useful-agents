# ADR-0018: Three-layer secret redaction in run logs

## Status
Accepted

## Context
The executor captured the full resolved environment as `inputsJson` on each node execution for debugging. Previously, only secrets explicitly declared in the node's `secrets:` array were redacted. This missed: (1) variables with sensitive names the user forgot to declare as secrets, (2) values that look like credentials regardless of their variable name.

## Decision
Expand `filterEnvForLog()` to three layers, preferring false-positive redaction over credential leaks:

1. **Declared secrets** — names in the node's `secrets:` array (existing behavior)
2. **Sensitive name patterns** — names matching TOKEN, KEY, SECRET, PASS, PASSWORD, CREDENTIAL (via `looksLikeSensitive()` from the variables store)
3. **Sensitive value patterns** — values matching known credential formats: GitHub PATs (`ghp_*`), OAuth tokens (`gho_*`), OpenAI/Stripe keys (`sk-*`), Slack tokens (`xox*-*`), AWS access key IDs (`AKIA*`), JWTs (`eyJ*.*`)

All three layers apply at capture time, before `inputsJson` is written to the DB.

## Consequences
- Run logs never contain credentials, even for misconfigured agents
- False positives: benign values matching patterns (e.g. a variable named `MY_KEY` with value "house key") are redacted unnecessarily. This is acceptable — the debug value is lower than the leak risk.
- The pattern list is extensible. New credential formats (e.g. GCP, Azure) can be added to `SENSITIVE_VALUE_PATTERNS`.
