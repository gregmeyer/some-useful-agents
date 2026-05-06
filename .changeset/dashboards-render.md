---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Render pack dashboards + add a switcher dropdown (widget-packs PR 4/5).

- **`GET /dashboards/:id`** renders any installed dashboard via the
  existing Pulse tile machinery. Unknown agents render as muted
  placeholder cards so the user knows what's missing.
- **Dashboards dropdown** above the Pulse header (and on each
  dashboard page) lists Default + every installed dashboard, plus a
  link to `/packs` to install more. Server-rendered `<details>` —
  no JS. Hidden when only the Default option exists (avoids noise).
- **Pulse stays at `/pulse`** as the "Default Dashboard" — its
  visible tiles are still the agents with `pulseVisible !== false`,
  computed on each request (no rows in the dashboards table).
- Refactor: extracted `buildPulseTile` from `routes/pulse.ts` to a
  new `views/pulse-tile-builder.ts` so the dashboards route can
  build identical tiles without cross-route imports.

5 new supertest cases; full suite 1027/1027 green. Live smoke:
install Starter pack → switch via dropdown to /dashboards/starter:media
→ Vimeo + cat-video tiles render in their "Video" section.
