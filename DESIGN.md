# Design System — sua

## Product Context
- **What this is:** A local-first agent playground for authoring, running, and managing AI agent workflows
- **Who it's for:** Developers who want a daily-driver workspace for agent management
- **Space/industry:** Developer tools, agent orchestration, workflow automation
- **Project type:** Web dashboard (server-rendered HTML, no frontend framework)

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian with editorial touches
- **Decoration level:** Minimal. Typography and whitespace do the work. No gradients, no shadows-for-show. The DAG visualization IS the decoration.
- **Mood:** A well-designed terminal UI that happens to be in a browser. Crafted but not corporate. Professional indie tool... serious enough to be your daily-driver, scrappy enough to feel like a community project you can fork.
- **Positioning:** Think Datasette crossed with Linear's density. Not the glossy SaaS look.
- **Anti-patterns:** No purple gradients, no 3-column icon grids, no centered-everything layouts, no decorative blobs, no generic SaaS card grids.

## Typography
- **Display/Headings:** JetBrains Mono (700) — the monospace IS the brand. Agent IDs, node names, run IDs, page titles all in mono. This is the single biggest differentiator.
- **Body:** System sans (system-ui, -apple-system, "Segoe UI", sans-serif) — fast, native feel, matches the local-first story. No custom font loading for body text.
- **UI/Labels:** JetBrains Mono (600, uppercase, letter-spacing 0.08em) — section labels, stat labels, card titles use small mono caps.
- **Data/Tables:** JetBrains Mono (400) — tabular data, exit codes, durations, timestamps.
- **Code:** JetBrains Mono (400) — terminal output, YAML, commands.
- **Loading:** Google Fonts CDN: `https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap`
- **Scale:**
  - xs: 0.6875rem (11px) — labels, hints
  - sm: 0.8125rem (13px) — secondary text, card descriptions
  - md: 0.875rem (14px) — body default
  - lg: 1.0625rem (17px) — section headings
  - xl: 1.375rem (22px) — page titles
  - 2xl: 1.75rem (28px) — hero/display (rare)

## Color

### Light Mode
- **Approach:** Restrained. One accent + warm stone neutrals. Color is rare and meaningful.
- **Background:** #faf9f7 (warm off-white, not cool gray)
- **Surface:** #ffffff
- **Surface raised:** #f5f4f2
- **Border:** #e7e5e4
- **Border strong:** #d6d3d1
- **Text:** #1c1917
- **Text muted:** #78716c
- **Text subtle:** #a8a29e
- **Primary (teal):** #0f766e — distinctive without being flashy, differentiates from the blue/purple every other dev tool uses
- **Primary hover:** #115e59
- **Primary soft:** #ccfbf1
- **Semantic:** success #15803d, warning #b45309, error #b91c1c, info #2563eb
- **Terminal:** bg #1c1917, fg #e7e5e4

### Dark Mode (default)
- **Background:** #1a1918
- **Surface:** #242220
- **Surface raised:** #2e2c2a
- **Border:** #3d3a37
- **Border strong:** #57534e
- **Text:** #e7e5e4
- **Text muted:** #a8a29e
- **Text subtle:** #78716c
- **Primary (teal):** #2dd4bf — brighter teal for dark backgrounds
- **Primary hover:** #5eead4
- **Primary soft:** rgba(45,212,191,0.1)
- **Semantic:** success #4ade80, warning #fbbf24, error #f87171, info #60a5fa (all use rgba soft variants at 0.1 opacity)
- **Terminal:** bg #131211, fg #e7e5e4

### Why warm neutrals?
The existing dashboard uses cool Tailwind grays (#fafafa, #e5e7eb). Switching to stone/warm neutrals (#faf9f7, #e7e5e4) is subtle but makes the tool feel handcrafted, not generated. The teal accent pops more against warm backgrounds than cool ones.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable (not cramped, not spacious)
- **Scale:** 1(4px) 2(8px) 3(12px) 4(16px) 6(24px) 8(32px) 12(48px)
- **Rule:** Every margin/padding uses a token. Zero inline `padding: 12px` values.

## Layout
- **Approach:** Grid-disciplined. Predictable alignment, consistent card sizing.
- **Grid:** Single column (mobile), 2-column (agent detail: DAG + inspector), 3-column (agent cards), 4-column (stat tiles)
- **Max content width:** 1200px (standard), 1400px (wide, for run detail with DAG)
- **Topbar height:** 48px
- **Border radius:** sm: 6px (badges, inputs), md: 10px (cards, modals), lg: 14px (reserved)

## Motion
- **Approach:** Minimal-functional. Only transitions that aid comprehension.
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) — hover states. short(150-200ms) — modal open/close, tab switch.
- **No bounce, no spring.** Fade + slide only. Keep transitions under 200ms.

## Voice and Vocabulary

Words are part of the design system. This section is authoritative for user-facing copy in
the dashboard and CLI help, the same way the Color section is authoritative for hex values.

### Voice
- **Say what the thing does, not what it is architecturally.** "Run an agent once and wait for
  the result" beats "Execute a DAG synchronously."
- **Second person, present tense, active voice.** "Your agents run on your machine." Not "Agents
  are executed locally."
- **State value, then reversibility.** The model is `/connect-model`'s "Give sua something to
  think with" — say why someone would want this, then make clear it can be undone.
- **Never promise a version.** Copy that says a feature "arrives in v0.15" is wrong the moment
  it ships and wrong forever after if it doesn't. Say "No dashboard equivalent yet" instead, and
  delete the sentence when it stops being true.
- **A CLI command is not a remedy for someone in a browser.** If the dashboard tells a user to
  run a terminal command, either give them the dashboard path first, or say plainly that the
  terminal is the only way today.
- **Don't name internal machinery in primary UI.** Subtitles, empty states, buttons, and option
  labels are read by people who have never seen the source.
- **Every top-level page introduces itself.** One line under the title — the `description` on
  `pageHeader` — saying what the page is for and what you can do from it. A bare title assumes the
  reader already knows why they are there. This is a permanent line, not a dismissible tip: use
  `pageIntro` for a *how-to* someone should be able to dismiss once learned, and the header
  description for *what this is*, which never stops being true.

### The words we use
| Concept | Say | Not |
|---|---|---|
| A thing you run | agent | workflow, DAG agent, v2 agent |
| One unit inside an agent | node | step, task, stage |
| An agent with several nodes | multi-node agent | DAG, graph |
| One execution | run | invocation, execution |
| Re-running from part-way | replay | re-entrant execution |
| The picture of an agent's nodes | diagram | DAG viz, graph viz |
| sua answering in the inbox | sua | the triage agent, `inbox-triage` |
| Older agent file format | the older format | v1, legacy v1 |
| The board of tiles | Pulse | information radiator, dashboard |

### Never ships to a user
`DAG` · `v1` / `v2` · `slot` · `outputWidget` · `executor` · `waterfall` · `fallback chain` ·
`topological order` · `planner` / `drafter` / `designer` · `contract` · `catalog via /api/...`

These are all fine in code, comments, ADRs, and this file. They are not fine in a page header,
a form subtitle, an empty state, a button, or an option label.

### CLI verbs in user-facing copy
Per [ADR-0032](docs/adr/0032-agent-is-the-user-facing-cli-verb.md), `sua agent` is the
user-facing verb. Use `sua agent run` / `sua agent list` in help, empty states, and docs.
`sua workflow` keeps `show`, `import`, `import-yaml`, `export`, `replay`, `logs`, `status`,
`rm` — reference those by their real names, but reach for `agent` whenever both exist.

## Dark Mode Strategy
- Dark mode is the **default**. Light mode is the fallback.
- Implemented via `[data-theme="dark"]` and `[data-theme="light"]` on `:root` or `<html>`.
- Toggle stored in localStorage, respected on page load to avoid flash.
- Semantic colors increase brightness/saturation slightly in dark mode.
- Surface hierarchy inverts: darkest = background, lighter = elevated surfaces.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-18 | Initial design system created | /design-consultation based on competitive research (Linear, Railway, Grafana, Warp, Raycast) |
| 2026-04-18 | JetBrains Mono as display font | Monospace-forward branding differentiates from Inter/system-font dev tools. Agent IDs and node names are already mono... lean into it. |
| 2026-04-18 | Warm stone neutrals over cool grays | Handcrafted feel over generated feel. Teal accent pops more against warm backgrounds. |
| 2026-04-18 | Dark mode as default | Developer tools live in dark mode. Ship what users actually use. |
| 2026-04-18 | Keep existing teal #0f766e | Distinctive vs. the blue/purple every competitor uses. Already established in the codebase. |
| 2026-06-29 | "Needs you" top-bar badge restyle (bordered soft-amber pill, mono count, pulsing dot, right-anchored) + formalized the 2xl (28px) token | The toast read as a flat wash floating mid-bar; a crafted, right-hugged pill fits the utilitarian-with-editorial direction. Added `--font-size-2xl` (the scale already documented 28px; the token was missing) so hero stats stop drifting to 32px. Added `.section-label` / `.stat-value` utilities to unify section headings + big numbers. |
| 2026-08-24 | Every top-level page carries an eyebrow description; `pageIntro` reserved for dismissible how-tos | Agents, Pulse, Runs and Settings rendered a bare title while Nodes, Packs, Behaviors, Scheduled and Help all had one — so the four most-visited pages were the four that said least. Pulse had been using a *dismissible* intro to say what it is, which meant the explanation disappeared permanently the first time anyone closed it. Split the two: permanent "what this is" in the header, dismissible "how to arrange it" in `pageIntro`. |
| 2026-08-24 | Added a **Voice and Vocabulary** section; swept the jargon it retires out of primary UI | Colour, type and spacing were governed; words were not, so jargon regrew after every sweep. The audit that prompted this found `DAG`, `v1`/`v2`, `executor`, `waterfall` and `planner/drafter/designer` in page headers, form subtitles and option labels — plus in-product help still promising features "in v0.15" at v0.27. A table of preferred terms is the only thing that makes a sweep stick past the next feature. |
| 2026-06-29 | Full token sweep: every hardcoded `font-size` + off-grid padding/margin in `*.css` and view templates remapped onto tokens | The dashboard read as "disjointed" — a 7-12px label soup and off-4px-grid spacing bypassed the otherwise-solid token layer. All raw sizes/spacing now consume `--font-size-*` / `--space-*`. Intentional exceptions: the 16px rem anchor, optical 1px nudges, relative `em` units. (Known remaining: a few hardcoded accent hexes in `.pulse-tile[data-accent]` duplicate `--color-*` — color, not sizing; deferred.) |
