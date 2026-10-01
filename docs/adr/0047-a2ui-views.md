# ADR-0047: Agent views are A2UI, validated by the A2UI processor itself

- Status: accepted
- Date: 2026-10-01
- Deciders: Greg Meyer

## Context

Widgets today come from 13 `signal.template`s, five `outputWidget` types and agent-written
HTML (`ai-template`); every new look means new TypeScript. The plan
(`~/.claude/plans/pulse-a2ui-canvas.md`) moves widgets to A2UI, an open declarative UI format
(v0.9.1 stable), so agents and the build planner can describe new widgets without code, and so
chat replies can carry UI. The user chose to support both **declared** views and views
**generated** by a node at run time from the start. A generated view is model output, so it
has to be validated before it's drawn.

The W0 spike vendored the official renderer (`@a2ui/lit` + `@a2ui/web_core` 0.12, v0.9
protocol) into the dashboard: 87 KB gzip, CSP-safe.

## Decision

- New agent field `view:`, either `{ components: [...] }` (declared, A2UI v0.9 components) or
  `{ from: <nodeId> }` (that node's output is the view; `<a2ui>` JSON, a fence, or bare JSON;
  optional `data` bound at `/data`).
- One fixed data model per run: `/outputs`, `/result`, `/inputs`, `/run`, `/history`, `/data`.
- **The sua catalog** = the A2UI basic catalog + `Metric`, `Badge`, `KeyValue`, `Table`, `Link`,
  `Code`, `SanitizedHtml`, defined with A2UI's own schema building blocks.
- **Validation runs the A2UI `MessageProcessor` in strict mode** (from `@a2ui/web_core`, pinned
  to 0.12.0 as a dependency of core) against the sua catalog. That is the same code the browser
  renderer runs, so server and browser can't disagree about what's valid. On top: at most 200
  components / 64 KB, literal image hosts must be in `permissions.imgSrc` (https or data:),
  literal link urls must be http(s). Declared views are checked at save/import (schema
  `superRefine`); generated views on every run (`resolveAgentView`), falling back to an error
  rather than raw output.
- sua components are written with `zod/v3` (zod 4 ships it), because `@a2ui/web_core`'s schemas
  are zod 3. They're built untyped (zod 3's types for A2UI's recursive values overflow tsc);
  the processor checks them at runtime.

## Consequences

- core gains a dependency: `@a2ui/web_core` 0.12.0 (Apache-2.0; brings zod 3, lit, preact
  signals; ~8 MB unpacked). Accepted for exact parity with the renderer.
- A2UI churns between versions; pinning exactly and keeping the format = A2UI v0.9 means a move
  to v1.0 is one conversion in one place.
- The browser-side elements for sua components (dashboard `a2ui-sua.js`) must match these
  schemas; a test comparing the two lands with the renderer (W2).
- Nothing is drawn from `view:` yet; W2 renders it on the run page and Pulse, WS2 in chat, and
  W3 converts existing widgets into views.
