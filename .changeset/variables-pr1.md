---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
---

**feat: global variables store + `sua vars` CLI (Variables PR 1 of 6).**

Adds a plain-text global variables store at `.sua/variables.json` for non-sensitive project-wide values (API_BASE_URL, REGION, DEFAULT_TIMEOUT). Variables are visible to every agent at run time — executor wiring comes in PR 2.

- **`VariablesStore`** in core — JSON-backed CRUD with `get/set/delete/list/getAll`. Creates the `.sua/` directory on first write.
- **`sua vars list/get/set/delete`** CLI — mirrors the secrets CLI pattern. `set` warns when a name looks sensitive (TOKEN, KEY, PASS, SECRET) and suggests using `sua secrets set` instead.
- **`looksLikeSensitive()`** helper — flags names that probably belong in the encrypted store.
