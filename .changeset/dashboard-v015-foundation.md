---
"@some-useful-agents/dashboard": minor
---

**feat: dashboard visual foundation + IA refactor (PR 1 of 5 for v0.15).**

Locks a design system and refactors the information architecture before v0.15's editor and settings features land. No behavior changes to the run/agent/secrets flows — visible surface only.

### What ships

- **Design system as real CSS.** Replaces the inlined `css.ts` template-literal with four source files under `packages/dashboard/src/assets/`: `tokens.css` (colors, type, spacing, radius, shadow), `base.css` (element defaults), `components.css` (badges, tables, buttons, flash, tab strip, modal, page header, filters), `screens.css` (per-screen grids). Concatenated at startup and served as `/assets/dashboard.css` with a 5-minute `Cache-Control`. Copied from `src/assets/` to `dist/assets/` by a new `copy-assets.mjs` post-build step, wired into the root `build` script.
- **Layout shell.** Adds a Settings + Help nav entry, a sticky footer with version + GitHub + Docs + Help links, and a shared `pageHeader()` component so every detail screen exposes the primary CTA in the same spot.
- **Agent detail (`/agents/:id`) → 2-column grid.** DAG viz stays on the left (60%); a right-column inspector panel shows agent metadata + secrets summary today and will become the node inspector in PR 3. Nodes / Secrets / Recent runs collapse into ordered sections under the grid.
- **Agents list → single table by default.** Unmigrated v1 YAML agents now hide inside a `<details>` disclosure ("Show N legacy v1 agents") instead of appearing inline.
- **Run detail → click-expandable node cards.** Each per-node execution renders as a `<details>` card; failed/errored nodes open by default so the user doesn't scroll hunting for failures, successful nodes collapse.
- **`/settings` skeleton.** New route tree with a tab strip (Secrets | Integrations | General), placeholder content in each. Concrete CRUD + passphrase modal + MCP token rotation land in PR 4.
- **`/help` route.** Static reference page listing the CLI surface grouped by purpose (getting started, agents & workflows, scheduling, secrets, MCP & dashboard), showing which commands map to dashboard features and which stay CLI-only. Includes a "Dashboard in 60 seconds" quick tour and a pitch for `sua tutorial`.

### Design tokens summary

- Type scale: 13 / 14 / 17 / 22 / 28
- Spacing: 4 / 8 / 12 / 16 / 24 / 32 / 48 (0.25rem–3rem)
- Radius: 6 / 10 / 14
- Shadow: subtle by default; `--shadow-md` reserved for modals + inspector slide-in (PR 3)
- Teal primary kept (brand continuity); contrast verified AA (4.98:1 primary on white, 4.67:1 muted on bg)
- Legacy class-name aliases (`.badge-ok`, `.flash-error`, `.run-now`, `.run-now-warn`, etc.) live in a compat block at the bottom of `components.css` so existing v1 view code keeps rendering without churn; removed in a follow-up PR once every callsite uses the BEM-style `.badge.badge--ok`.

### Files

- New CSS: `packages/dashboard/src/assets/{tokens,base,components,screens}.css`
- New scripts: `packages/dashboard/scripts/copy-assets.mjs`
- New views: `packages/dashboard/src/views/{page-header,footer,help,settings-shell}.ts`
- New routes: `packages/dashboard/src/routes/{settings,help}.ts`
- Modified: `layout.ts` (stylesheet link + footer + nav), `agent-detail-v2.ts` (2-col + inspector aside), `agents-list.ts` (v1 disclosure), `run-detail.ts` (node cards), `components.ts` (BEM badge names), `routes/assets.ts` (serves concatenated CSS), `index.ts` (mounts settings + help routers)
- Deleted: `packages/dashboard/src/views/css.ts`
- Infrastructure: root `package.json` build script runs `copy-assets.mjs` after `tsc --build`

### Constraints preserved

- No CDN, no bundler, no client framework
- No new external dependencies
- Existing 420-test suite still passes; no behavior regressions

### Plan

Full scope in `~/.claude/plans/dashboard-v0.15.md`. Remaining v0.15 PRs:

- PR 1.5 — dashboard-native tutorial at `/help/tutorial` (step-by-step guided flow)
- PR 2 — mutation endpoints + version history + status toggle
- PR 3 — node inspector editing + DAG drag-drop
- PR 4 — settings CRUD + passphrase modal + MCP token rotation
- PR 5 — replay UI + states & microcopy polish
