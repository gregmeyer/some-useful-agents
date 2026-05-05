---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Rescue analyzer/builder LLM mistakes in `outputs:` and ai-template widgets,
and add truthy `{{#if outputs.X}}` to the template grammar.

Three changes that close a "Fix with AI" loop where every suggestion failed
validation with `outputs.X: Expected object, received string`:

- **Discovery catalog** now shows the canonical `outputs:` syntax with
  examples of both shorthand (`count: number`) and full form, and explicitly
  flags the two common LLM mistakes (description in the type slot, camelCase
  keys). The previous one-liner said "declare the shape" without a single
  example, which invited free-text descriptions in the value slot.
- **`autoFixYaml`** now coerces any string value in `outputs:` to
  `{ type: 'string', description: val }` (instead of leaving non-type strings
  alone) and snake_cases camelCase keys. Strings are the most permissive
  output type, so this is safe and unblocks the user.
- **`/analyze/fix-yaml` retry prompt** now lists the outputs rules so a
  second LLM pass can actually fix the problem.
- **ai-template `{{#if outputs.X}} … {{/if}}`** now supported as a truthy
  conditional (single-level, no `else`, no helpers). LLMs reach for this
  constantly when describing "show success card if found"; the workaround
  was always-render which produced broken UIs. Helpers like `(eq …)` and
  `{{else}}` deliberately remain unsupported — render two templates and
  switch via a field-toggle for branching.
- **`autoFixYaml` Fix 6b** un-escapes `{ {` → `{{` (and `} }` → `}}`)
  inside `outputWidget.template`, mirroring the existing fix for
  claude-code prompts. Without this, the renderer printed escape
  sequences as literal text.
- **Discovery catalog** documents the full ai-template grammar (including
  `#if` and `#unless`) and explicitly enumerates what's NOT supported, so
  the builder LLM stops reaching for `(eq …)` and `{{else}}`.
- **`{{#unless outputs.X}}`** added as the falsy complement to `#if`. Two
  adjacent blocks (`#if X` … `#unless X`) replace the if/else pattern
  without dragging in `{{else}}` parsing.
- **`autoFixYaml` now runs on every YAML save**, not just on AI-suggested
  YAML from the analyze flow. Hand-edited and pasted YAML get the same
  rescues (un-escape `{ {`, shorthand outputs, signal/template
  normalisation).
- **`<iframe>` allowed conditionally** in `sanitizeHtml` — HTTPS only,
  host on a small allowlist (YouTube + Vimeo to start), with a forced
  `sandbox="allow-scripts allow-presentation"` regardless of input. Was
  unconditionally stripped before, which made video-embed templates
  impossible. Author-supplied sandbox attrs are overridden so an
  `allow-same-origin` injection can't escape.
