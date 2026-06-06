---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Validate that shell `$UPSTREAM_<NODE>_RESULT` references point at a declared dependency.

The executor only injects an upstream node's output as `$UPSTREAM_<NODE>_RESULT`
for DIRECT `dependsOn` edges. A shell command that reads a transitive ancestor's
output gets an unbound variable — which crashes the node under `set -u` (and
silently yields empty output without it). This was a recurring LLM-codegen bug:
agent-builder would wire a command to an ancestor it forgot to depend on, and the
schema check only caught the `{{upstream.X}}` template form, not the shell env-var
form.

Agent schema validation now flags a `$UPSTREAM_<NODE>_RESULT` (or
`${UPSTREAM_<NODE>_RESULT}`) reference whose node isn't a declared dependency (or
doesn't exist), while leaving safe defaulted forms `${UPSTREAM_X_RESULT:-…}` alone.
Because agent-builder's `validate` node runs this check, the builder's `fix` step
now self-corrects this class of bug. Also fixes the bundled `conditional-router`
example, which had exactly this latent bug (an empty "TECH ALERT:" output).
