# ADR-0070: A board's page is a layout composed from its agents' outputs

- Status: accepted
- Date: 2026-11-06
- Deciders: Greg Meyer
- Builds on: ADR-0047 (views are A2UI), ADR-0049 (boards as documents with versioned saves), ADR-0056 (a notebook's layout is an A2UI document), ADR-0065 (representation levers; "boards can use the same parts")

## Context

A board such as a Morning Brief (a digest, the weather, markets, scores, world news) was a `Column` of `Section`s, each a `Grid` of equal `AgentTile` boxes. Every tile is its own nested surface with its own data; the board surface itself carried no data. So a board could arrange boxes, but could not say "the lead headline here, the temperature there", and could never read like the front page it is for.

Notebooks already had what a front page needs: a layout as data whose parts bind to the notebook's data under `/notebook/*`, resolved with `when` flags, empty parts dropped, pending skeletons, presets, an editorial lint, and the Lead / Figure / Panel-treatment parts. The question was how a board gets the same without a second mechanism, and where a board's page lives.

## Decision

1. **The board's document is the page.** A composed page is stored in `doc_json` like any board: an A2UI document whose parts carry `when` and bind to `/board/...`, with `AgentTile` still allowed (and `chrome: bare` inside a Panel). One version counter, one undo, one save path; the arranging operations, `board-place` and the editor work on the same document (Panel and Columns are containers to them now). Beside it, `layout_meta_json` says how it came to be composed: a preset, sua's own (`board`), picked (`picked`), asked for in words (`you`). A plain grid of tiles is a page too (nothing conditional, nothing bound), so every existing board is already one, unchanged.
2. **One resolver, two prefixes.** The notebook's resolver is now a generic `resolveLayout` (core `layout-resolve.ts`): `when`, `<prefix>/layout/<key>` settings, empty parts, skeletons, list caps; `resolveNotebookLayout` is a wrapper that adds the notebook's own rules, `resolveBoardLayout` the board's. `pageRhythm` and the treatments are shared as they are.
3. **A board data model, `/board/*`.** The board's name and date, and per agent its latest result's fields (`/board/agents/<id>/outputs/<field>`, the same `runOutputs` an agent's view binds), its run, and its numbers shaped for a Lead or a StatStrip. Flags: `<agentId>` (it has a result), `running:<agentId>`, `numbers:<agentId>`. A composed page's parts are drawn only once their agent has run, stay as skeletons while it runs, and take new data in place as the agents rerun (the board refetches its canvas on its tiles' shortest refresh and after a Run).
4. **Presets are documents or code, never the model's guess at a value.** `grid` is the document as it is; `front-page` is filled by code from the agents' output shapes (names and kinds, never values): a masthead, a lede (the agent with a headline, as a Callout), a story column beside a rail of numbers, a band of figures. The picker uses it without a model; the page agent (the next part of this work) starts from it and binds only to fields the agents have.

## Consequences

- Validation keeps the extensions: a document with `when` or `/board/...` bindings is checked as a board with everything would draw it (`checkBoardLayout`), then stored unresolved; it is resolved on every draw.
- A part bound to an agent counts as placing that agent (`boardDocAgentIds`), so a composed page without a tile for an agent still runs it on build and lets other tiles target it.
- Pulse stays a grid ("Everything else" and hidden tiles have no place on a front page).
- The editor can move, wrap and remove a composed page's parts and retitle its Panels; it can't yet add a Panel or Columns, bind a part, or change a treatment. That stays with sua (the page agent, "Arrange with sua") and Undo.
