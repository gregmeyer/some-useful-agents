---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Rescue analyzer/builder LLM mistakes in the `outputs:` block.

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
