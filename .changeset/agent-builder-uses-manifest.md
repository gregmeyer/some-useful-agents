---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

agent-builder uses the manifest layer.

Wires the manifest data shipped in PR A.5/A.6/A.7 into the existing `design → validate → fix` agent-builder DAG. Three changes:

**Discovery catalog upgrade** — `buildDiscoveryCatalog` now sources node-types from the canonical `NODE_CATALOG` (PR A.7) instead of a hand-authored string, and includes per-agent `outputs:` (PR A.5) + `capabilities:` (PR A.6) in the AVAILABLE AGENTS section. New CRITICAL — OUTPUT WIDGET FIELD SCHEMA section calls out the most common bug (`name:` is the JSON key, not a label; do NOT use `source:`/`path:`/`from:`/`key:`). New DESIGN DISCIPLINE section enforces decomposition (3+ stages → 3+ nodes), `outputs:` declaration, and template-syntax rules.

**Agent-builder prompt** — `agents/examples/agent-builder.yaml` adds explicit decomposition discipline, outputs declaration rules, widget field schema rules with concrete examples, and signal-template/title rules.

**`autoFixYaml` extensions** — five new fixes for residual LLM mistakes the prompt doesn't always prevent:
- Widget field `source:` / `path:` / `from:` / `key:` → `name:` (with smart name/label swap when name was treated as a label)
- Invalid `signal.template` → fallback to `text-headline`
- `signal.title` JSEP-style expression → strip to first quoted segment
- `signal.mapping.*` non-string value (array/object) → `result`
- `outputWidget.title` (invented field) → silently strip

**Dogfood result**: rebuilt the same weather-agent prompt that produced 6 distinct bugs in the baseline. Improved version produces clean YAML with `outputs:` declared, multi-node decomposition, correct widget field names, plain-string signal title, and a smarter API choice (Open-Meteo + geocoding instead of wttr.in). 12 new tests for the autoFixYaml extensions.
