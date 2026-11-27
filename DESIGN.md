# Design System — sua

## Product Context
- **What this is:** Ask a question; get back a researched answer you can check, laid out the same clear way every time. Underneath, a local-first agent playground for authoring, running, and managing AI agent workflows: the agents do the research.
- **Who it's for:** Anyone with a question worth researching (a purchase, a meeting, a how-to, a decision), and developers who want a daily-driver workspace for agents
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
- **Page header:** every page opens the same way (`pageHeader()` in `views/page-header.ts`, `.page-header` in CSS): breadcrumbs (`Home › …`, the last one this page), then the title (22px display) with its counts beside it and its actions at the right as small buttons, then one line saying what the page is for. Pages with their own markup (Home, Pulse and boards) use the same classes.
- **Control heights:** `--control-h` 32px (`.btn`), `--control-h-sm` 28px (`.btn--sm`, the top bar's pill, Ask sua and theme toggle, pickers). Controls that sit side by side share one height and the 13px (`sm`) text size; 11px (`xs`) is for labels and hints, never for something you press.
- **Border radius:** sm: 6px (badges, inputs), md: 10px (cards, modals), lg: 14px (reserved)

## Notebook pages (editorial)
A notebook's page is drawn for its job (a briefing, a shortlist, a report), so it reads like a magazine spread, not a dashboard: a few strong parts with a clear lead, not a grid of equal boxes. Still disciplined: parts choose from a short list of treatments and row shapes; nothing is placed freely.
- **Treatments** (a Panel's `treatment`): `plain` (today's frame; for tools like the shortlist), `lede` (no frame, the eyebrow title in teal, the opening part), `feature` (no frame, a 2px rule above the title, the main story), `aside` (no frame, a hairline rule on its left, small mono caps title; facts and context), `band` (full width on surface-raised; a strip of themes or stats).
- **Expressive variants:** ProfileCard `cover` (a 160px portrait, the name at 28px display, an optional pull quote), Agenda `numerals` (large teal mono numbers), QuoteList `lead` (its first quote set as a pull quote), FactSheet `ruled` (hairline rows, no grid), AnswerSections and Figure `rubric` (an If / Then / Why table as ruled decision rows: the condition bold, the action in teal, the why muted beneath).
- **Representation parts** (say it with a number or a drawing, never another box): `Figure` (one written part on its own; `size: hero` draws a ladder with 36px bars, a split as a 44px band, a rubric as ruled rows), `Lead` (the one number that matters: a small mono label, the value at 28px display in teal, a line under it naming the option), `Bars` (options by one numeric field, best first in teal, the rest muted), `Compare` (two or three options side by side, their facts ruled line by line, names in mono under a 2px rule).
- **The ready-made pages use the parts:** the shortlist's rail is done-when over two `Lead`s (the best by the deciding field, how many have one), its top three `Compare` as a feature after the grid, and `Bars` by that field where the map would be; the watch opens with what changed beside a `Lead`; the answer's details and the plan's days are each page's `hero`, full width, with rubric tables as ruled rows (`rubric: auto`). Thumbnails on How it looks draw each part: a lead as a short line over a thick accent bar, bars, two ruled columns, tracks.
- **What-if controls** on a diagram (a ladder, a split): a row of sliders above the drawing, one per what-if, each a mono-caps label (`xs`), a range input at the small control height with the accent colour, and its value in mono `sm` teal at the right; a bordered **Reset** at the same height appears only once something moved. The drawing itself redraws in place, no motion. Never a control the reader can't tell from a figure: the row sits above, never inside, the bars.
- **Pending parts:** while a step runs, a part with nothing yet keeps its frame and title with three grey rules (`--color-surface-raised`, 10px tall, 88 / 64 / 42% wide) in place of its child. No shimmer, no motion: the rules are a placeholder, not a progress bar; the header's working panel says what's running.
- **The hero:** a page composed around what was written leads with one part marked `hero` on its Panel: its title set at 28px display, full width, a lede or a feature, never inside a row. One per page.
- **Page shapes:** from the top, "hero + rail" (the hero full width, then a 2:1 row), "story + rail" (a feature column with asides), or a "band" opener (a Lead or StatStrip row, then the story).
- **Row shapes:** full width, 2:1, 1:2, 3:2, 1:1:1. Two rows in a row never have the same shape.
- **Rhythm:** one lede, at most 3 framed (`plain`) parts on a drawn page, long lists (quotes, tables, timelines) in a feature or a fold, never an aside.
- **Type:** the 2xl (28px) display size is for a cover's name, pull quotes, a hero's title and a Lead's value on notebook pages; everything else keeps the scale above. No new colours: teal for ledes and numerals, rules in the border tokens.

## Notebook briefs on paper
A brief (the saved page or PDF of a notebook) is the page set for reading away from the app. It keeps the page's parts and order; these rules are for paper.
- **One document, every kind:** every brief is set by one shell (`views/brief-document.ts`): the head (kind · date in the accent colour at left, "Prepared by sua" muted at right, the title, a 2px rule under it), sections numbered in the accent colour, a colophon. A renderer says what a brief contains; it never restyles the document.
- **Line length:** prose stops at about 75 characters. A wide page gets a second column or white space, never a longer line.
- **Two sizes on paper:** 10.5pt for what's read first; 9pt for what's looked up (facts, tables, asides, captions).
- **The ending is a colophon,** not a log: where it looked and how much it found in one sentence, then what the brief is and its date, in `xs`.
- **Facts are a spec sheet:** a sidebar of facts moves under the part it sat beside and is set in two columns, each read down: every fact a row with its label in a 104px column at the left and the value beside it, a hairline above. Two lists side by side, not rows across (a one-line fact beside a paragraph leaves a hole).
- **Quotes two to a row:** the theme label above the quote, the source's name under it, a 2px rule at the left.
- **Pages fill and break cleanly:** A label stays with its list; a list never leaves one line alone on a page. A part that can't print prints no heading.
- **Labels:** one face for every small caps label (section labels, a fact's label, a table's headings, a quote's theme): the display face, 600, uppercase, 0.06–0.08em. Never two label faces on one page.
- **Links:** body sans, underlined, in the accent colour. Mono is not used for links.
- **Where something comes from:** a superscript number in the accent colour after what it supports, never a link or a "From …" line in the body. The sources are listed once at the end under "Source notes", two to a row in `xs`: the number, the source's name in the text colour, its address as a link under it. A table has no source column.
- **Contrast:** text a reader acts on (a talking point's reasoning) prints in the text colour; the muted colour is for sources, dates and counts.
- **A question to ask** sits on its own line under its point: a 2px accent rule at the left and a small "ASK" label.
- **Tables** are ruled, not boxed, with no tinted panel behind them. **Checks** use their mark (✓ ○) as the bullet.
- **A goal that only repeats the title** is left out.
- **The head can be a cover:** when a page opens on who or what it's about, the cover (photo 96px on paper, the name at 28px display, role · company, a line on them) is the head's big type and the notebook's title a small muted line above it. The name is never printed twice.
- **A meeting briefing leads with what to say:** straight after the head, the talking points two to a row with a 28px gutter, numerals in the accent colour, each point's question on its own ruled line; then questions beside what to watch for under a hairline. On paper the lead is set at 10pt / 9.5pt with 1.42 leading so it shares page 1 with the head. Facts, the company and the rest follow in the page's order.
- **Section numbers are written on the headings,** not counted in CSS (a counter stops inside a column that is a container).

## Boards as front pages
A board you read every morning can be composed like a front page instead of a grid of equal boxes, with the notebook page's parts (ADR-0070): the same treatments, row shapes and rhythm rules apply.
- **Masthead:** the one hero, a `feature` Panel titled with the board's name (28px display) and the date as its note, a caption under it saying how fresh the newest result is. One per page, full width, first. Today's edition titles it with the date alone, since its tab names it.
- **A part's age:** each Panel's note is its result's age ("13d ago"). A part older than the page's day says why it's there in a caption under its title. A part is read, not used: no input forms on a front page.
- **Lede:** the lead story as a `lede` Panel holding a Callout bound to an agent's headline and summary fields; never a tile.
- **Story and rail:** a 2:1 `Columns`, `align: start`: the story column holds `feature` Panels, the rail `aside` Panels. A number that matters leads an aside as a `Lead` over the agent's tile.
- **Band:** a full-width `band` strip of figures (a StatStrip of every agent's numbers), low on the page, only when two or more agents have numbers.
- **A tile inside a Panel is bare** (`chrome: bare`): no frame, no header, no palette; the Panel supplies the title, the tile keeps its footer (the agent, when it ran, Run). Framed (`plain`) Panels are for tools, at most 3.
- **Pending and empty parts:** a part of an agent that hasn't run isn't drawn; while its run is going it keeps its place with the three grey rules; a part bound to a field that came back empty goes.
- **Phone:** Columns stack as on notebook pages (story first, then the rail); the masthead stays first.

## Motion
- **Approach:** Minimal-functional. Only transitions that aid comprehension.
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) — hover states. short(150-200ms) — modal open/close, tab switch.
- **No bounce, no spring.** Fade + slide only. Keep transitions under 200ms.

## Working
When you ask sua for something that takes more than a moment, the page shows **at once** that it heard you and has started, in one standard way (`working()` in `views/working.ts`, `window.suaWorking` in scripts, `.working` in `components.css`). No new dots, pulses or spinners of a page's own.
- **The ring:** a spinning ring in the primary colour, the one motion allowed to loop. With reduced motion it stands still, dotted.
- **Inline:** a 14px ring and a few words ("Drafting…"). Used in the button you pressed (which is disabled and says what it's doing), and in a page's status line ("sua is setting up this notebook…").
- **Panel:** a 32px ring, then:
  - a title that says sua heard you ("sua heard you and is drafting your notebook");
  - what you asked, in your words, quoted;
  - what it's doing and roughly how long it takes;
  - an elapsed time counted on the page, never a made-up progress bar or fake stages.

  Put it right where you acted (under the box you typed in), never below other content.
- **Done:** say so where you'll see it. When what you're waiting for is long (a draft to check), bring its top into view with a ✓ and the next button there ("Looks right, start it"), and keep that button in view (a sticky bar) while you read.

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
| What sua researched for you | answer (its kind: Shortlist, Meeting brief, Company brief, Topic brief, Explainer, How-to, Plan, Watch) | notebook (fine in code, URLs and the CLI) |
| Starting one | Ask a question | New notebook, start a notebook |
| Where an answer learned something | source | evidence |
| Older agent file format | the older format | v1, legacy v1 |
| The board of tiles | Pulse | information radiator, dashboard |
| The providers tried in turn | provider order; "moves on to the next provider" | waterfall, fallback chain, chain |

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
| 2026-10-22 | Home is full width in two columns (Today; a rail with your notebooks and Try next) with the shared page header; a quiet Today says **All clear** and offers ask-sua pills; Try next suggests agents that run as they are | Home was a 1100px column centered in a 1600px page with its own ⋯ header, and its empty Today was one muted line that led nowhere. |
| 2026-10-22 | One page header everywhere: breadcrumbs on every page, 22px title with counts beside it, small-button actions at the right, a one-line description under it | Home, Pulse, Notebooks and the `pageHeader` pages (Agents, Settings, Help) each opened differently: 17px or 22px titles, a breadcrumb on Notebooks only, full-size action buttons on some. |
| 2026-10-22 | One control scale: `.btn` 32px, `.btn--sm` 28px at 13px text (was 11px); the top bar's pill, Ask sua and theme toggle at 28px and 13px; the board picker is a `btn--sm` with one ▾; Pulse's toolbar buttons are bordered and drop their emoji glyphs | Side-by-side controls were three heights and two text sizes (the topbar pill at 13px beside 11px Ask sua; an 18px-tall board picker beside 11px ghost links), so every header looked unbalanced. |
| 2026-10-22 | Home's header controls are one row of `btn--sm` buttons: notebooks with a joined "+", "Autonomy: Full ▾" (a menu that says what each setting does), Adjust Home | The row mixed a link with an icon, a tiny "+ New" link, a dot with a mono-caps label beside a segmented switch, and a bordered button, at four heights. One button size and one menu pattern read as one toolbar. |
| 2026-10-23 | Settings → Appearance is visual: the look now as a light and a dark mini dashboard, a gallery of brands and presets drawn in their own colours (one click uses one, Undo goes back), and Fine-tune with swatches, Dark/Light tabs, one corners slider and a font list, redrawing the previews as you edit | It was ~45 text fields of hex codes with "default" placeholders, a radio row of presets that did nothing until Save at the bottom, and three boxes with no order; you couldn't see a look before using it. |
| 2026-11-03 | The ready-made pages take the representation parts: two Leads in the shortlist's rail, Compare and Bars, a Lead on the watch page, the answer's details and the plan's days as heroes, `rubric: auto` | The parts only appeared on pages composed after writing; the ready-made shortlist still said its best price in a tile, mapped only with two numeric roles, and never weighed the top options side by side. |
| 2026-11-03 | A notebook page fills in place (the same parts take new data where they stand) and a part with nothing yet holds its place as three grey rules while a step runs | Every poll replaced the whole column, so the page jumped and a moved slider snapped back; empty parts were pruned, so the page's shape only appeared once every step had run. Static placeholders, not shimmer: the working panel already shows progress. |
| 2026-11-02 | An answer's ladder or split can be moved: sliders above the drawing (mono-caps label, accent range input at the small control height, mono teal value) and a bordered Reset once something moved; the drawing redraws in place | A page had nothing to do on it; an artifact has a moment where the reader moves a number and watches. Controls take the existing control scale and mono values so they read as part of the page, not a form. |
| 2026-11-02 | Notebook pages get representation parts (Figure, Lead, Bars, Compare), a `rubric` table variant, one `hero` per composed page, and three page shapes | A page composed from what was written still read as boxes of equal weight: a rubric was a 3-column grid, a ladder sat at a third of the width, the number that decided it was a table cell. Levers over boxes: the model picks the hero and the representation, code draws every pixel. User-approved (catalog only, no model markup). |
| 2026-10-25 | Notebook pages get editorial treatments (lede, feature, aside, band, plain), expressive briefing variants, fixed row shapes and rhythm rules | Drawn notebook pages read as grids of equal boxes; a briefing and a car search had the same rhythm. Treatments keep them disciplined (no free placement) while letting each job read like itself. User-approved. |
| 2026-08-24 | Added a **Voice and Vocabulary** section; swept the jargon it retires out of primary UI | Colour, type and spacing were governed; words were not, so jargon regrew after every sweep. The audit that prompted this found `DAG`, `v1`/`v2`, `executor`, `waterfall` and `planner/drafter/designer` in page headers, form subtitles and option labels — plus in-product help still promising features "in v0.15" at v0.27. A table of preferred terms is the only thing that makes a sweep stick past the next feature. |
| 2026-06-29 | Full token sweep: every hardcoded `font-size` + off-grid padding/margin in `*.css` and view templates remapped onto tokens | The dashboard read as "disjointed" — a 7-12px label soup and off-4px-grid spacing bypassed the otherwise-solid token layer. All raw sizes/spacing now consume `--font-size-*` / `--space-*`. Intentional exceptions: the 16px rem anchor, optical 1px nudges, relative `em` units. (Known remaining: a few hardcoded accent hexes in `.pulse-tile[data-accent]` duplicate `--color-*` — color, not sizing; deferred.) |
| 2026-10-26 | One "working" component: a spinning ring, inline or as a panel (title, what you asked, what it's doing, elapsed time); ready states lead with a ✓ and keep their main button in view | Starting a notebook showed an 8px pulsing dot under the templates, far from the button, so it wasn't clear sua had heard or started; once the draft was ready, Start was at the bottom of a long form. About ten pages had their own pulse or spinner. |
| 2026-11-26 | **A comparison's scorecard and 2x2.** Scorecard: the option, then its score as a range out of 100 with a bar (solid to the lower bound, dashed to the upper; teal for the leader only), how much is known (warn under the minimum), the gates as ✓ ✗ ? in mono, then each criterion's 0–4 (— for unknown, never 0) under its label and weight; criteria scroll sideways, the score never does. Provisional and out rows say why in a mono line under the name (warn only for out). Under it, one line: who leads, or that no one does yet, and any weights that would change that. The 2x2 is the Scatter with both axes 0–100, dashed midlines, a mono-caps word in each corner, the leader in teal; a point with too little known isn't placed, and the legend counts it. | The skill asks for a rubric that shows its uncertainty and a 2x2 that isn't read as a verdict. The range bar shows unknown weight as space still open, and the corners name places, not decisions. |
| 2026-11-26 | **Skills page.** /skills under Agents → More: ruled rows with a mono-caps eyebrow (SHIPPED, YOURS, YOUR COPY · vN) and the size against 6 KB in mono (warn only past it), the name in mono, one line of what it's for, and "used by N agents" with links. A skill's page: the text (lines wrapped by hand read as paragraphs), "As a SKILL.md" folded, and a side column with Used by (Remove each), Add to an agent, Versions (Restore) and the one way back (sua's version, or Delete when unused). The form: name, what it's for, the know-how in mono with a live size count; a pasted SKILL.md fills the name and description. | Skills were only files or a builder's proposal. One calm page per skill, the same ruled-row look as the inbox, and the limits shown where you'd break them. |
| 2026-11-26 | **Save the template card (from a skill).** The card's usual ruled rows (muted label column, ink text): what it's for, asks you for, limits, gates, steps (each agent in brackets), facts each notes, done when, its page. Then "Scored 0–4 on N criteria" and one row per criterion: its label, the weight in mono and its side (suitability or feasibility), with "what 0–4 mean" folded under it as a list numbered from 0. One muted note: nothing runs until a notebook is started, and unknown is never 0. | A template from a skill has to be read before it's saved. The weights and anchors are the decisions, so they get their own rows; the anchors fold so the card stays short. |
| 2026-11-25 | **An answer with the drawer open.** One column at full width; the side column's other cards (Sources) follow the answer; the ask card hides. A briefing's cover name wraps (overflow-wrap) in a narrow column. | Hiding the ask card had left its 340px column empty beside a squeezed answer. |
| 2026-11-25 | **Inbox polish.** The conversation's header scrolls with it (only the reply box stays pinned) and has top padding; ★ ⋯ sit on the right edge; the reply box is one box (no focus ring on the field inside it); row rules are straight; the step fold sits in the message column. Today folds more rows for the same answer under the first ("2 more for this answer"). No pill radii left in inbox.css (dots are 50%, everything else radius-sm); dead classes removed. An answer page's ask card hides while the sua drawer is open. Grid cards wrap long facts instead of running past the edge. | The pinned header had grown to half the pane and clipped messages; doubled borders and curved rules read as mistakes. |
| 2026-11-25 | **The Inbox page.** /inbox and /inbox/:id are the Inbox, not Home: crumb Home › Inbox, h1 Inbox, one mono meta line ("3 need you · 21 open", warn when someone needs you) with Autonomy on it, then the list and the thread. Home's goal line, its intro card, the answers button and Adjust Home stay on Home (/). | The inbox page wore Home's chrome, including Home's goal prompt shown as its description. |
| 2026-11-25 | **The conversation's header.** A mono-caps eyebrow (what it is), the title without "Answer: ", ★ and ⋯; one mono meta line (state, warn only while waiting on you · with agent, agent as plain links · run · age · #tags); the answer card; the body and any approval stay in view; the answers it started, its context and its summary go under one "Details (N)" fold. Avatars: one rule, you teal-soft and everyone else stone (the duplicate avatar block is gone). No pills or chips outside the ⋯ menu's tag editor (square there). | The header had a blue status pill, agent and tag pills, two avatar rule sets that disagreed, and up to 12 blocks. |
| 2026-11-25 | **The inbox's rows and panel.** A row is a ruled line: a mono-caps eyebrow saying what it is (ANSWER, DIGEST, CHAT · agent, FAILING · agent, DRAFT…) and its age, the title (without the stored "Answer: "), one line of where it stands ("Done · 7 options · 4 sources"; sua's words without "sua: "). The dot says only whether it needs you: amber, pulsing teal while answered, hollow otherwise (info blue and error red leave the inbox). Today's card actions are quiet text buttons (Apply fix · Not now); ⋯ on hover holds move/pin/hide and "Why it's here". The panel bar reads INBOX with + and ⋯ (Widen, Minimize, Refresh, Open full inbox); tabs are underline tabs at 13px with mono counts; things to ask show as plain lines under the focused, empty search; no footer. | The panel showed ~15 controls before the first row, pills that overflowed, a grey segmented control with 11px tabs, five dot colours, and no way to tell an answer from a chat or a digest. |
| 2026-11-25 | **One place to ask.** Home has its question box and no "sua ›" bar above it (other pages keep the bar; ⌘K everywhere). Beside an answer, one card under its sources has two tabs: **Ask a follow-up** (each follow-up listed with Under way / Done →) and **Tell sua about this one** (the talk card as it was). Ask a follow-up opens first once its steps are done; Tell sua while they run or when sua asked a question. | Home had three places to ask and the answer two near-identical boxes; one card with tabs keeps both actions without the duplication. |
| 2026-11-25 | **The answer first.** The Shortlist page leads with where it stands / the lay of the land, the options, the write-up and what it rests on, and its sources; its charts, head to head, checklist, timeline, search log and limits sit under one fold ("Charts, checks and how it was found"). Saved Shortlist pages are upgraded in place (as Runbook is). A "Sources · N" side card lists the first three (found first, ✓/✗/not checked yet) and counts the rest. Drawn pages keep their own order. | The shortlist showed 14–15 parts at equal weight; the first screen now holds the answer, the options and the sources (≤3 framed parts, per Notebook pages). Words lead; charts follow, folded. |
| 2026-11-25 | **A calm answer header.** In view: the kind as an eyebrow, the title and ★, "You asked", one meta line (started · N sources, M checked · From this conversation →), the one thing to do now (next step, Try again + Move on, Narrow…, Decide…, Reopen, or Stop while running), Print and More. More holds Edit (also the e key), + Add entry, Decide…/Narrow… when not the main thing, and every format. Everything else (steps and their buttons, Update all, what you gave it, limits, cadence, what's new, How it was made, Run the pipeline now, Done when) is under one "Steps and details" fold, open when a step stopped short and remembered per browser. One band at a time: waiting on you > answer behind > what's new. While a step runs, a compact steps list shows under the meta line. | The header showed 14–16 controls when done. Every action is still on the page (a test checks the URLs); only what you need now is in view. |
| 2026-11-25 | **One Done moment.** When an answer's last step of sua's finishes, the conversation says "Done: N options, N sources, N quotes found… One step is yours: X. [Open the answer →]" once; the conversation's card shows the answer's kind and a compact steps list (✓ / spinner / ! / ● yours / ○, each with the step's own note, no invented progress); runs of step messages fold behind "Show each step"; the top-bar pill reads "✓ Done: <title>" for 30 minutes and opens it. | DESIGN's Working rule says to announce done where the user will be; a 12-minute run means they've left. One message, one link, and the pill reach them wherever they are. |
| 2026-11-25 | **Answers first.** The top bar is Answers · Settings · More (Agents, Experiments, Pulse, Help in a short menu; it shows the page you're on), with the brand as Home. Home leads with an **Ask a question** box (the one-line pitch and three examples to start from) above its parts; a new Home shows Today and your answers, the rest a Show away. The Agents tabs are Agents · Runs · Scheduled · More. | The pitch is "ask a question, get an answer you can check", so the first thing on every page should be asking one. Seven top-bar links and seven Home parts buried it; the building blocks stay one click away. |
| 2026-11-27 | **Pictures an agent made.** In a conversation, under a finished run's picture: one quiet row, "Add this picture to" a select (the conversation's answer first) and a small **Add** button; once added, a muted line "Added to [answer]." A picture sua can't read is a muted line saying so with the path in mono, never a broken image. On the answer's page they sit under a **Pictures** region title (the same small caps as the other regions), each at the column's width with a hairline border, the title in ink and a link to its run in muted text under it. On Tools → Servers, a server run in Docker gets a ghost **Clean up** button beside Disable and Delete; what it did is said in the page's flash. | A picture belongs to the answer it was made for; the page shows it in any layout without a new part to place. |
| 2026-11-27 | **Pictures an agent made, revised.** Under a run's picture (which opens full size), one row: once it's in an answer, "In [answer]" with a ghost **Remove**; before, one small **Add to [answer]** button for the conversation's answer and a muted **Another answer** disclosure holding a compact select (at most 8, never every answer) and a ghost Add. A conversation about one answer files it there by itself and says so. The widget's own "Open Output" link is dropped when the picture shows. In the brief, **Pictures** is a section before the sources, each at the text's width with its title under it; its note isn't listed again among the notes. | The first version showed a select of every answer, kept the form after adding (so it could be added twice), and repeated the file link. |
| 2026-11-11 | Home leads with **Next up**: one framed lead (17px title, accent rule at the left, a line of why, one primary button) and up to four plain rows under it, each with one small button and a quiet "Not now". Today shrinks to its All good line on a quiet day. Housekeeping is a folded `<details>` | On a normal day Home was "All clear" over rows of generic pills; the page had nothing to lead with. One lead and rows, not a grid of cards |
| 2026-11-11 | Home's one large item is **Today's brief**: a headline, the lead number at display size in the accent, its week as columns (2px gaps, today filled in the accent, the rest in the soft accent), up to three figures in ink each with a 2px trend line and an accent dot for today, and the top story. Next up under it is plain rows | Home was still a wall of sentences. Figures and drawings carry what the sentences in Today's reads say; text stays in ink, the accent marks only the lead and today |

## Runtime brand theme

The tokens here are the product's defaults. An operator can override colours, fonts, radius and tile accents for their own dashboard in Settings → Appearance (see docs/brand.md); that theme is served as `/assets/theme.css` on top of `tokens.css`. Product UI must therefore style only through tokens (`var(--color-*)`, `--accent-*`, `--palette-*`), never raw values outside `tokens.css`, or it won't follow the operator's brand.
