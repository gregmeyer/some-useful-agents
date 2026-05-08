---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Two daily-greeting dogfood bugs:

1. **Inline replay form now honours input specs.** The Re-run button's inline input fields previously rendered as bare `<input type="text">` with no value attribute and no enum awareness — so `daily-greeting`'s `NAME` input showed empty even though the YAML declared `default: friend`, and `STYLE` was a free text field instead of a dropdown of its declared `enum` values. The renderer now mirrors the wizard form: `<select>` with options for enum/boolean, `value=spec.default` pre-fill for everything else.

2. **`{{inputs.X}}` in shell commands now auto-fixed in both forms.** The build-planner sometimes generates shell commands using `{{inputs.X}}` template syntax (correct for claude-code prompts, wrong for shell). `autoFixYaml` already rewrote the canonical form to `$X`; it now also catches the space-escaped `{ {inputs.X}}` form that the template-substitution pipeline produces when planner output is piped through `{{upstream.X.result}}`. Plus a planner-prompt update so this generation mistake should happen less often: the catalog now explicitly contrasts shell `$VAR` vs claude-code `{{inputs.X}}` syntax.
