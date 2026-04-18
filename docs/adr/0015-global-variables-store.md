# ADR-0015: Global variables store (plain-text, non-sensitive)

## Status
Accepted

## Context
The system had secrets (encrypted, global), agent inputs (per-agent, runtime-only), per-node env, and upstream outputs. There was no first-class concept for "plain, non-sensitive values configured once and used across agents" (e.g. API_BASE_URL, DEFAULT_TIMEOUT, REGION). Users had to duplicate values across agents or misuse the secrets store for non-sensitive config.

## Decision
Add a global variables store at `.sua/variables.json` (plain JSON, not encrypted). Variables are referenced as `$NAME` in shell nodes and `{{vars.NAME}}` in claude-code prompts. Precedence: `--input` override > agent input default > global variable > secret.

Dashboard surfaces via `/settings/variables` tab (CRUD with values shown, unlike secrets) and the template palette autocomplete. CLI via `sua vars list/get/set/delete`.

Variables are explicitly NOT sensitive. Names that look like secrets (TOKEN, KEY, PASS) trigger a warning suggesting the secrets store instead.

## Consequences
- Simple JSON file is easy to version-control alongside the project
- No encryption overhead for config values
- Clear separation: sensitive = secrets store, non-sensitive = variables store
- The `looksLikeSensitive()` heuristic may have false positives, but warnings are non-blocking
