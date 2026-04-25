# ADR-0020: AI-generated template widget (`ai-template`)

## Status
Accepted

## Context
The output widget system (raw / key-value / diff-apply / dashboard) covers a useful breadth of layouts but hits a ceiling: any "show the score as a big number, with a pill badge underneath, and an inline sparkline of the last 7 results" request requires either a bespoke widget type or a frustrated user writing HTML manually somewhere sua doesn't render.

We want agents to declare arbitrary, polished output views **without** expanding the core widget registry every time a new shape is needed. Options:

1. **A plugin system** — agents ship React components or similar. High ceiling; high complexity (build step, runtime, sandboxing, type conflicts with the server-rendered dashboard).
2. **Generate the layout once with an LLM, store HTML, render on every run.** Low runtime cost (no per-run LLM call); bounded attack surface (sanitize once at save, once at render); aligns with the "OpenUI widgets" direction in the roadmap.
3. **Generate fresh per run** — maximal dynamism, but ~2–5s latency on every page load and every run costs tokens.

## Decision
Ship option 2 as a new `ai-template` widget type alongside the existing four. The editor adds a prompt textarea + Generate button + read/editable template textarea + live preview card. The save-time Generate call:

- Sends the user's prompt, any declared field names, and an optional run-output sample to a `TemplateGenerator`
- The generator is abstracted — `claudeTemplateGenerator` ships by default (spawns `claude --print` with a strict system prompt); `registerTemplateGenerator()` accepts provider swaps (codex, gemini, custom)
- Returned HTML runs through the allowlist sanitizer (ADR-0021) before it reaches the DB
- `{{outputs.NAME}}` and `{{result}}` placeholders in the template are filled at render time by the same field extractor the other widget types use (XML tag or JSON key)
- Values are HTML-escaped before substitution; the whole substituted string is sanitized again before emission (belt + suspenders)

The `OutputWidgetSchema` gets two new optional fields — `prompt: string` (the user's original phrasing, preserved for iteration) and `template: string` (the stored HTML). The `fields` array becomes optional (ai-template uses placeholders, not declared fields) via a `superRefine` that enforces at-least-one-field for every other widget type.

A request-abort path uses `AbortController` client-side + `req.on('close')` server-side, so clicking Cancel in the generate modal actually kills the `claude` subprocess instead of letting it run to completion.

## Consequences
**Easier:** agents can declare bespoke scorecards, inline charts via SVG, color-coded states — all without schema changes to core. The provider abstraction lets codex/gemini/etc. plug in without touching routes.

**Harder:** we now own an HTML allowlist (ADR-0021). Any tag an LLM might emit that we haven't allowed gets silently stripped — users may iterate on prompts without knowing why (partial mitigation: the editor shows the sanitized output so mismatches are visible).

**Trade-off accepted:** save-time generation means the template is frozen at save. If an agent's output shape changes (new fields, renamed fields), the template goes stale until regenerated. We prefer stale-over-expensive; a per-run regenerate button could be added later if demand is real.

**Not done here:** per-run regeneration; streaming generation responses into the editor; a gallery of community templates; the editor's "Cancel" path does not currently resume from where it was when cancelled (a fresh Generate click starts over).

## Alternatives considered
- **Per-run generation** (option 3 above) — rejected for cost and latency.
- **Component plugin system** (option 1) — rejected for complexity. Would require its own ADR.
- **Make `ai-template` a subtype of the existing widget types** (e.g., an HTML-template sub-option on `dashboard`) — rejected because the render path is fundamentally different (template vs field extractor), and overloading the existing types adds branching without clarity.
