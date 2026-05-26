# @some-useful-agents/mcp-server

## 0.22.0

### Minor Changes

- 885f237: Belt-and-suspenders timeout enforcement: kill orphaned LLM processes on reboot + agent-level wall-clock ceiling.

  Follow-up to the orphan reaper (last release). The reaper closed the state-machine bleed but didn't stop the orphaned `claude`/`codex` CLI from continuing its current API call. This release adds the two pieces needed to make timeout enforcement actually stop the token burn:

  **Agent.timeoutSec — wall-clock ceiling for the whole run.** Per-node `timeout` protects against one node hanging; agent-level `timeoutSec` is the umbrella that catches "10 nodes at 60s each legitimately runs 10 minutes." When the run exceeds the ceiling, the executor aborts the in-flight node (SIGTERM, then SIGKILL after 5s via the cancel-path escalation shipped last release) and marks remaining nodes as cancelled. The run's `error` names the cap directly: `Agent wall-clock timeout (60s) exceeded.`

  `layout-planner.yaml` (the agent that revealed the orphan bug) now declares `timeoutSec: 60` — normal runtime is ~20s, the cap catches the dashboard-restart-orphan case without flagging legitimately-slow runs.

  **Persist child PID + start time on `node_executions`.** Two new nullable columns: `childPid` (the spawned process's OS pid) and `childStartedAtMs` (wall-clock ms at spawn time). The executor wires `spawnProcess`'s new `onSpawn(pid, startedAtMs)` callback to write both onto the in-flight node row the moment `spawn()` returns.

  **Reaper now kills the orphan.** When a `node_executions` row carries `childPid` + `childStartedAtMs`, the orphan reaper SIGKILLs the process before transitioning the row. To defend against PID reuse on long-uptime machines, it first parses `ps -p <pid> -o etime=` and compares the actual elapsed time against the stored start time; if they've drifted apart (PID reuse), the kill is skipped. Production callers get this automatically; tests inject a `killProcess` hook.

  `reapOrphanedRuns` now returns `pidsKilled` alongside `runsReaped` / `nodesReaped`. The dashboard boot log surfaces all three.

  Tests: +13 (4 for agent timeout, 1 round-trip, 3 for kill behavior, 5 for etime parsing). 1603 pass / 3 skipped.

- e56f176: Build eval now catches dead image links the drafter LLM hand-writes into agents.

  Drafter LLMs frequently bake literal asset URLs into generated agents (e.g. a
  shell node with an array of Wikimedia portrait URLs) and hallucinate the path.
  These pass the structural critic — the host _is_ declared in
  `permissions.imgSrc`, so the page CSP allows it — but the URL 404s and the
  widget renders a broken image. Observed in the wild: ~1/3 of the Wikimedia URLs
  in a drafted "Marvel hero of the day" agent were dead links.

  The build evaluation now extracts every hardcoded `http(s)` image URL from each
  generated agent and HEAD-checks it. Definitively-gone links (HTTP 404/410) are
  fed back to the planner/drafter as critic-style feedback so the next attempt
  fixes the source (or drops the image) instead of committing an agent that
  renders broken. Inconclusive results — network errors, timeouts, 401/403
  (hotlink), 429 (rate-limit), 5xx — are never flagged, so an offline or
  rate-limited build host can't produce false failures. Template placeholders
  (`{{outputs.image_url}}`) and data URIs are skipped (not statically verifiable
  / can't 404). The check runs in both the multi-agent `PlannerLoopRunner` eval
  phase and the single-agent drafter critic-retry loop.

  New `@some-useful-agents/core` exports: `extractImageUrls`, `findDeadImageUrls`,
  `checkPlanImageUrls`, `defaultCheckImageUrl`, `formatDeadImageFeedback`,
  `formatImageCheckFeedback`. `PlannerLoopRunnerDeps` gains an optional
  `checkImageUrl` dependency; omitting it skips the check (keeps tests/offline
  builds network-free).

- e56f176: Fail runs whose widget output references CSP-blocked image hosts (root-cause fix).

  When an ai-template widget rendered an `<img>` from a host not in the agent's
  `permissions.imgSrc`, the browser silently blocked it and the run-detail auto-poll
  re-fired the CSP violation on every 2s refresh — filling the console with repeating
  "Loading the image '…' violates the following Content Security Policy directive"
  errors.

  Fixed at the source: the executor now checks a finished run's widget output against
  the agent's `permissions.imgSrc` and, if it references an un-allowlisted image host,
  marks the run **failed** with an actionable error naming the host(s)
  (`unallowedWidgetImageHosts` / `formatBlockedImageError`, new in
  `@some-useful-agents/core`). The run-detail view hides the broken widget for such a
  run (so the blocked image never renders or re-fires the violation) and renders a
  **server-side** one-click "Allow host" form per blocked host — robust because the
  hidden widget fires no CSP violation, so a client-JS banner would have nothing to
  react to. The `allow-host` endpoint accepts that form POST and redirects back to the
  run (same-origin redirects only); allow the host, then Retry run. As a safety net,
  the live poll also pauses when any CSP img-src violation is detected
  (`window.__suaCspPaused`), so residual cases on rendered widgets can't spam the
  console either.

  Separately, widget images that load from an _allowlisted_ host but still 404 (an
  LLM hand-wrote a Wikimedia path with the wrong hash, so the run completes but the
  image is dead) no longer show a broken-image glyph. A capture-phase image-error
  listener swaps any failed widget `<img>` for an inline SVG "Image unavailable"
  placeholder (`data:` URI, permitted by the CSP `img-src` allowlist), preserving
  the failed URL in a tooltip. This is the graceful fallback for hallucinated image
  URLs that slip past the host-level checks.

- c7bae0f: Rename a dashboard from the editor.

  The dashboard editor (`/dashboards/:id/edit`) now has a name field + Rename
  button, posting to a new `POST /dashboards/:id/rename` route. Renaming
  re-upserts with the existing id, packId, and layout — so the stable id never
  changes and the dashboard stays findable for delete (and pack uninstall, for
  pack-owned dashboards) after the display name changes. The editor header now
  shows that stable id. The built-in "Default Dashboard" (the Pulse view) has no
  stored row and is not renameable by design.

  Pack-owned dashboards can't be deleted directly (deleting would just reappear on
  pack reload). Their editor now explains this and links to the owning pack's page,
  where uninstall removes the pack's dashboards while keeping contributed agents.

- c7bae0f: Install packs from Pulse without leaving the page.

  The dashboards dropdown's "+ Install from Packs" now opens an in-place modal
  listing every registered-but-uninstalled pack, each with an Install button, plus
  a single "Browse all packs →" link to the full packs page. Installing posts to
  `/packs/:id/install` with `returnTo=/pulse`, so you land back on Pulse with a
  success flash instead of being bounced to the pack detail page. The install
  route now honors a loopback-only `returnTo`. Without JS the link still navigates
  to `/packs`.

- c7bae0f: Dashboard nav: Pulse-first top bar with in-page Agents section tabs.

  The top navigation is now `sua · Pulse · Agents · Settings · Help`, with Pulse
  promoted to the first nav item. The building blocks and executions —
  Agents, Tools, Nodes, Runs, Packs — are grouped under **Agents** and surfaced as
  an in-page tab strip on each of those landing pages, mirroring the Settings
  shell (no separate global subnav bar). The top-level "Agents" item links to the
  agents list and stays active across the whole section. URLs are unchanged; this
  is purely an information-architecture grouping so the daily-driver surfaces
  (Pulse, then your agents) lead, and the supporting pages stay one click away
  without crowding the top bar.

  On Pulse, the dashboard selector dropdown moves from above the page title to the
  right side of the header row, so it no longer sits on top of the "Pulse" heading.

- 7ae30a4: Fix: orphaned runs after dashboard restart no longer burn tokens silently.

  When the dashboard process died mid-run (a `daemon restart`, a crash, an OOM), any in-flight LLM child process was reparented to launchd/init and kept running. The 180-second per-node timeout was an in-memory `setTimeout` inside the dashboard process — it died with the parent. The new dashboard had no `activeRuns` entry for the run and couldn't abort it, and the `runs` row sat at `status='running'` indefinitely. The user-cancel route's fallback path force-updated the `runs` row but left every `node_executions` row stuck on a spinner forever.

  This release ships three fixes that close the bleed:

  - **Orphan reaper on boot.** Any run still flagged `running` or `pending` when the dashboard starts is, by definition, an orphan — the only process that could be executing it is the dashboard, and it just started. The reaper transitions the run to `failed` and every still-`running`/`pending` node execution to `failed` with new `errorCategory='abandoned'` so dashboards stop polling, notify logic doesn't fire forever, and the audit trail explains the gap. Idempotent; safe to call repeatedly.

  - **SIGKILL escalation on the cancel path.** When the abort signal fires, the spawner now SIGTERMs the child and escalates to SIGKILL after 5 seconds — matching the timeout path. A claude/codex CLI stuck in a slow HTTP read can no longer ignore SIGTERM indefinitely.

  - **Cancel route finalizes node rows.** `POST /runs/:id/cancel`'s fallback (used when activeRuns is empty because the dashboard restarted between kickoff and cancel) now walks every `running`/`pending` node execution for the run and transitions it to `cancelled` alongside the run-level update.

  Note: this release does NOT yet kill the orphaned child process itself — that requires persisting the child PID on the `node_executions` row (followup). What this stops is the state-machine bleed: rows stop sitting at `running` forever, and the run row gets a coherent terminal status.

- 38691bf: dashboard: new /scheduled page + Pause/Resume per row + widget surfaces paused agents.

  The home "Scheduled" widget filtered out paused agents — an agent with `schedule: "0 * * * *"` and `status: paused` was invisible even though the schedule is still on record and one click away from firing again. That hid scheduled-but-quiet agents from the user and made it hard to find what to stop.

  This release adds a dedicated `/scheduled` page under the Agents tab strip listing every agent with a schedule, regardless of status. Each row carries a one-click **Pause** (active rows) or **Resume** (paused rows) form; both POST to dedicated `/scheduled/:id/pause` and `/scheduled/:id/resume` routes that flip status and redirect back to the list. Schedule cron stays declared either way — pause is reversible. Permanent removal (clearing the cron) still lives on `/agents/:id/config`.

  The home widget is updated alongside: it now includes paused agents (badged), shows the same inline Pause/Resume button per row, and links "View all →" to the new page.

  Note: this PR does not yet wire pause/resume on the agent loop runner or planner-loop runs — only the per-agent `agents.status` field. The scheduler already honors that field (only `status='active'` agents fire), so the user-visible behavior is correct.

- e56f176: Widget tiles grow to fit their content, with a resize handle to pin height + scroll.

  Tall output widgets used to get an internal scrollbar inside a capped tile. Now:

  - **Tiles grow vertically by default.** A widget tile is as tall as its content
    (readable, no scrollbar); width stays the dashboard-defined grid column. New
    `outputWidget.tileFit` controls this per widget: `grow` (default) or `scroll`
    (cap height + scroll). The output-widget editor exposes the choice. The full
    run/agent detail view always renders at natural height regardless.
  - **Resize handle pins a height.** Dragging a tile's resize handle in layout-edit
    mode now sets an explicit height, snapped to a short grid unit, and the tile
    body scrolls anything taller — so you can shorten a tall tile and it scrolls
    instead of growing. Width still snaps to dashboard columns. Persisted per tile
    in the existing layout localStorage.

  Also: the dashboard CSS is served `no-cache` (was `max-age=300`) so style/layout
  fixes land on refresh instead of being masked by a 5-minute stale cache — the
  same trap that made an earlier tile change look broken until a hard reload.

### Patch Changes

- e56f176: Fix: run-detail live updates no longer wipe the DAG graph or the CSP "Allow" banner.

  The run page auto-polls every 2s and swaps in a fresh `[data-run-container]`
  fragment via `innerHTML` + `replaceWith`. Two pieces of client UI didn't survive
  the swap:

  - **DAG graph went blank.** Scripts inserted via `innerHTML` never execute
    (HTML5), so the cytoscape bootstrap stopped running after the first poll and the
    new `#dag-canvas` rendered blank for the rest of the run. The bootstrap is now a
    re-callable, per-canvas-idempotent global (`window.renderDagViz`) that the poll
    re-invokes after each swap, so the graph stays visible and node colors update
    live as the run progresses.
  - **CSP "Allow host" banner disappeared mid-run.** The banner for CSP-blocked
    widget images was mounted _inside_ `[data-run-container]`, so the poll destroyed
    it; the violation listener's host-dedupe then suppressed re-rendering, so the
    "Allow" button vanished on the first poll and never came back. It's now mounted
    as a sibling in the container's stable parent, surviving every swap.

  The root cause behind both was that the poll replaced the entire
  `[data-run-container]` every 2s. The poll now **reconciles only the regions that
  changed** (`data-poll-region` markers: status, meta, error, result, nodes) instead
  of nuking the container — so the DAG canvas (kept via a `data-poll-preserve`
  region), focused inputs, the node search/filter, and scroll position all survive a
  live update. The DAG bootstrap re-renders only when its data actually changed
  (signature check), reusing the same `#dag-canvas` element. Finally, the
  currently-running DAG node now **pulses** (glowing halo + breathing border) so
  it's obvious at a glance which step is live.

  Also fixed: the DAG sometimes rendered only the middle node. Cytoscape doesn't
  auto-resize, so if the initial `fit()` ran before the canvas reached its final
  size (sticky grid settling, fonts loading), the viewport stayed zoomed to a
  stale box and the outer nodes were clipped. The bootstrap now attaches a
  `ResizeObserver` that re-fits on any canvas resize. And `graph-render.js` is now
  served `no-cache` (it was `max-age=300`), so DAG fixes land on refresh instead of
  being masked by a 5-minute stale cache.

- c154655: dashboard: DAG canvas zoom + sticky Node execution header.

  The DAG viewer on run detail now supports interactive zoom (wheel + drag-pan, plus a floating +/⧇/− toolbar in the bottom-right of the canvas) and renders the canvas a notch taller by default (380px standard, 240px for 1–2 node graphs) so labels and arrows read clearly without zooming.

  The Node execution panel below the DAG now has a sticky header — title, search, and status filter stay pinned at the top of the viewport while the user scrolls through long node-card lists. The sticky DAG/Result bar above is released automatically (via a small scroll observer) the moment the Node execution section reaches the release line, so the two sticky surfaces don't fight for the top of the screen.

- 33cfbd4: Widen dashboard content cap so wide screens stop showing a large dead gutter.

  The global content max-width was hard-capped at 1200px (1400px for wide pages), so on large monitors the centered layout left big non-flexing gutters on either side and clipped wide content rows. Raised `--content-max` to 1600px and `--content-max-wide` to 1760px so pages use more horizontal space while keeping a readable cap.

- 3901b1f: Dashboard run-display and Pulse-layout polish.

  - Run detail no longer shows the literal "exit null" for DAG/multi-node runs
    (the run-level exit code is null by design); it shows a muted "—" instead.
  - Node stdout strips a single enclosing Markdown code fence, so llm-prompt
    output wrapped in `json … ` renders clean instead of showing the backticks.
  - Trivial graphs (1–2 nodes) use a compact DAG canvas instead of the full-height
    one, so single-node agents don't render a giant lone node in empty space.
  - The Pulse grid sizes each tile to its own content instead of stretching every
    tile in a row to the tallest one, so short metric/status tiles no longer
    render as near-empty cards.
  - Broken widget images cap their placeholder height so a failed hero image
    doesn't leave an oversized box.
  - The named-dashboard header (`/dashboards/:id`) now mirrors Pulse: the dashboard
    name is the prominent heading with tile-count/source meta beside it, and the
    dashboards dropdown plus actions move into the right-aligned group.

- 160169f: Fix `sua dashboard start` crashing / mis-starting when the port is in use.

  Express's `app.listen(port, host, cb)` invokes its callback even when the bind
  fails, so a busy port (EADDRINUSE) could resolve an unbound server — printing a
  bogus "running" banner — or leak as an uncaught error and crash on startup.
  Binding now keys off the `listening` event so a port conflict reliably rejects.
  The CLI then reports it clearly: if a dashboard is already running it prints the
  sign-in URL and exits 0; otherwise it explains the port is taken and suggests
  `--port <port>`.

- 55c0c8a: Show interactive output widgets on Pulse/dashboard tiles even when `signal.template` isn't `widget`.

  Pulse dispatches tile rendering on `signal.template`, so an agent that declared
  an interactive `outputWidget` but left `signal.template` as e.g. `text-headline`
  (several shipped examples do) rendered an empty slot template instead of the
  widget on first view. Interactive widgets are tile-level mini-apps that render
  without a prior run, so they now always own the tile. Non-interactive widgets
  paired with a compact `signal.template` (e.g. a metric tile) are unchanged.

- 13f31f6: dashboard/scheduled: Activate one-click on draft rows + explanatory hint for non-firing statuses.

  Follow-up to the new /scheduled page. The page listed drafts with a `schedule:` declared but offered no row action — leaving the user with `Every day at 7:00 AM` next to `—` in Next fire and a "why didn't this run?" question. The answer is that the scheduler only fires `status='active'` agents.

  Now:

  - **Draft rows get an `Activate` button.** Posts to a new `POST /scheduled/:id/activate` route that flips status `draft → active`. Same shape as Pause/Resume; 303 redirect with a flash; idempotent guards.

  - **Non-active rows get an explanatory Next-fire hint.** Drafts render `won't fire — status is draft` (with a tooltip explaining the scheduler-only-fires-active rule). Archived render `won't fire — archived`. Paused continues to show `—` (the cron is paused-by-intent and one click away from firing on Resume).

  - **`never` in Last fire gets a tooltip.** Clarifies that the column counts only scheduler-triggered runs — manual runs via dashboard / CLI / MCP don't count, so an agent that's been run manually but never by the scheduler shows `never` here by design.

  Tests: 1614 pass / 3 skipped (+4 new: draft renders Activate + hint, activate flips status, idempotent on already-active, archived hint with no row action).

- Updated dependencies [885f237]
- Updated dependencies [e56f176]
- Updated dependencies [e56f176]
- Updated dependencies [e56f176]
- Updated dependencies [c154655]
- Updated dependencies [33cfbd4]
- Updated dependencies [3901b1f]
- Updated dependencies [160169f]
- Updated dependencies [c7bae0f]
- Updated dependencies [c7bae0f]
- Updated dependencies [c7bae0f]
- Updated dependencies [7ae30a4]
- Updated dependencies [55c0c8a]
- Updated dependencies [13f31f6]
- Updated dependencies [38691bf]
- Updated dependencies [e56f176]
  - @some-useful-agents/core@0.22.0

## 0.21.0

### Minor Changes

- c1f605a: dashboard: add-tile modal offers two paths to create a new agent

  The add-tile modal on /dashboards/:id now ends with a footer that
  exposes both paths: **+ Blank agent** (links to /agents/new) and
  **Build from goal** (opens the existing AI wizard). Picking
  "Build from goal" closes the add-tile modal and opens the goal
  wizard on top — the dashboard view now renders the wizard's modal
  (it was previously only on /agents and /).

- 6459542: Planner refactor PR 4 — generated agents can declare `successCriteria` and run inside an eval loop.

  Closes the 4-PR planner refactor. After PRs 1-3 brought the loop/eval/memory model to the planner itself, this PR extends the same shape to every agent: when an agent declares `successCriteria`, its execution is wrapped in `AgentLoopRunner`, which re-runs the DAG (up to `maxLoopIterations`) with prior-iteration eval feedback in `LOOP_FEEDBACK` until either eval passes or the budget is exhausted.

  **Schema additions** (both optional; absence = single-shot pass-through, no behaviour change for existing agents):

  - `successCriteria: [Criterion]` — discriminated union of `shellExitZero` / `fileExists` / `jsonPathEquals` / `regexMatch`.
  - `maxLoopIterations: 1..5` — defaults to 1 (criteria evaluated but no retry on failure). Explicit opt-in (≥2) required for retry behaviour.

  **Wiring**:

  - `LocalScheduler.v2Deps` accepts `agentMemoryStore`; scheduled fires go through `executeAgentLoop`.
  - Dashboard `run-mutations` route (manual retry) routes through `executeAgentLoop`.
  - CLI `sua schedule start` instantiates `AgentMemoryStore` and threads it in.

  **Each iteration writes one row to `agent_memory`** (root_run_id + iteration as the grouping key), capturing inputs / observations / eval status / failure list.

  **`LOOP_FEEDBACK`** input is automatically populated on iteration 2+; iteration 1 sees an empty string. Agents opt in by referencing `{{inputs.LOOP_FEEDBACK}}` (claude-code) or `$LOOP_FEEDBACK` (shell).

  30 new tests (20 eval-criteria + 3 memory-store + 7 runner). Docs added at `docs/success-criteria.md`. Total of 1420 passing across the 4-PR refactor.

- d72d4e6: agents: declare CSP image-host allowlists via `permissions.imgSrc`

  Agents can now opt their tile widgets into rendering images from external
  hosts by declaring them in YAML:

  ```yaml
  permissions:
    imgSrc:
      - images.unsplash.com
      - "*.unsplash.com"
  ```

  The dashboard middleware merges every active agent's `imgSrc` hosts
  (prefixed with `https://`) into the page-wide CSP `img-src` directive
  on each request, with a 5s in-memory cache so the recompute is cheap.
  Wildcards (`*.example.com`) pass through unchanged — CSP supports them
  natively. Uninstalling an agent automatically tightens the CSP. Hosts
  are validated as lowercase host names; schemes/ports aren't accepted.

  Also fixes a Cytoscape deprecation warning on the run-detail DAG view:
  `width: label` was replaced with a function that sizes nodes from the
  label length, dropping the console noise.

- 1da69c4: Surface Advanced LLM options on `/agents/new` and tighten the radio copy.

  PR #300 added per-node LLM options (`provider`, `model`, `maxTurns`, `allowedTools`) to the add-node and edit-node forms but missed the initial-create page. This release fills the gap. The four fields sit under a collapsed `<details>` block ("Advanced LLM options") so the common case — a quick prompt, no extras — stays terse, but power users can set allowedTools / model / maxTurns at create time without round-tripping through an edit page.

  Radio copy on `/agents/new` tightened from _"runs an LLM prompt — you have Claude Code and Codex installed"_ to _"runs an LLM prompt (Claude Code, Codex installed)"_. The em-dash sandwich was redundant.

- 6fa5149: dashboard: Build-from-goal wizard asks where to land the result

  The wizard now opens with a target picker:

  1. Just create the agent(s) (default — backwards-compatible)
  2. Create agent(s) + a new dashboard
  3. Add to an existing dashboard (with a dropdown of user dashboards)

  The commit endpoint honors the choice: agents-only drops any planner-proposed dashboard, new-dashboard synthesizes one with the created agents if needed, and existing-dashboard appends the new agents to section 0 of the chosen user dashboard (pack-owned dashboards aren't selectable). On `/dashboards/:id`, the current dashboard is pre-selected as the target so you can iterate on it without picking again. Available on every surface that runs the wizard (/, /agents, /dashboards/:id).

- 84ecaa8: Split the monolithic build-planner into three focused agents orchestrated at the route layer. Per-agent drafting now runs as its own LLM call, so each draft has its own timeout and the Improve-layout Path B hand-off can run 3 drafters in parallel instead of one timeout-prone megacall.

  **New agents:**

  - `goal-surveyor` — classifies intent, decomposes goal into fragments, matches against installed agents.
  - `agent-drafter` — drafts ONE agent from ONE fragment.
  - `dashboard-designer` — designs the dashboard section layout from a finalized agent-id list.

  **New endpoint:** `POST /agents/draft-one { purpose, suggestedName?, focus? }` — fast path used by the Improve-layout wizard. Skips the surveyor and designer, runs one drafter, returns a single-agent BuildPlan when complete. Polling reuses `GET /agents/build/:runId`.

  **`POST /agents/build` rewrite:** now kicks off a session-based orchestrator that runs surveyor → fans out drafters in parallel → optionally runs designer → assembles the BuildPlan. External contract unchanged; the wizard still polls one runId and gets the same BuildPlan shape back, with per-drafter progress surfaced during the running phase.

  **Improve-layout wizard:** the "Draft N agents + apply" button no longer hands off to Build-from-goal. It drives N parallel `/agents/draft-one` calls inline, shows a card per draft with independent progress, then commits the drafted agents + the layout in one flow. The sessionStorage hand-off (`sua-layout-handoff-v1`) is removed. The Build-from-goal modal is no longer rendered on `/pulse`.

  **Build-from-goal wizard:** unchanged externally except the spinner stage now renders per-drafter progress pills when the orchestrator is in its drafting phase.

  `build-planner.yaml` remains in `agents/examples/` for now but the orchestrator never invokes it.

- 417bae9: Build-from-goal no longer crashes when the goal is already covered by an existing agent. The goal-surveyor can legitimately return `intent="agent"` with a matched existing agent and zero fragments to draft ("you already have this") — the old strict survey validation rejected that with `Survey failed validation: fragments: intent="agent" requires exactly one fragment, got 0`. Intent is now treated as a hint rather than a contract: the survey-schema drops the intent-vs-content cross-validation, and the orchestrator decides from the actual fragments + matched agents. When there's nothing new to draft but the goal matches installed agents, the wizard shows a friendly "Nothing to build — already covered by these agents" screen (with links) instead of an error.
- 63db5d1: `sua agent audit` now falls back to the project DB when no on-disk YAML matches.

  Agents created via the dashboard's Build-from-Goal flow live in the project SQLite store, not in `agents/local/*.yaml`. Previously running `sua agent audit <id>` against them printed "not found". This release adds a DB lookup as the second-pass resolver: if `loadAgents()` doesn't find the id on disk, the CLI opens the project DB read-only, fetches the agent, and prints its canonical YAML via `exportAgent()` with a banner noting the storage location.

  Side effect: v2-only on-disk YAMLs (which `loadAgents` didn't surface because that loader is v1-shaped) now audit successfully too via the same path. The on-disk v1 audit path is unchanged for v1 agents.

- f1c4228: One-click "Allow" for CSP-blocked widget images on the run-detail page. When a widget renders an `<img>` from a host that isn't in the page `img-src` allowlist, the browser blocks it silently. The run-detail page now listens for the CSP violation, attributes it to the run's agent, and shows a banner with the blocked host(s) and an Allow button. Allowing merges each host into the agent's `permissions.imgSrc` (new version) via the new `POST /agents/:id/permissions/allow-host` endpoint, then reloads so the images render. Full URLs are normalized to bare hosts, so pasting an image URL works too. The replace-everything `/permissions` form on the agent Config tab still exists for manual edits.
- 16b0422: Add a build stamp so you can tell which code a running daemon is serving. `npm run build` now writes `dist/build-info.json` with the git short SHA (suffixed `-dirty` for an unclean tree) and an ISO build timestamp. The dashboard footer shows the commit next to the version (`sua v0.x · 260589e`, build time on hover), and `/health` returns `commit` + `builtAt`. Verify with `curl -s localhost:3000/health | jq '{commit, builtAt}'` against `git rev-parse --short HEAD`. Falls back to `dev` when the stamp is absent (running straight from tsc without the post-build step, or in tests).
- 260589e: Removing the last tile from a user-owned dashboard now offers to delete the empty dashboard. The tile-delete route flags the redirect with `emptyDashboard=1` when no tiles remain; the dashboard view then shows an in-app modal ("Delete empty dashboard, or keep it to add tiles later?") with Delete dashboard / Cancel. Pack-owned dashboards are excluded (they can't be deleted directly). The confirm modal was refactored to support programmatic invocation (`showConfirm({ message, title, label, onConfirm })`) in addition to the existing `data-confirm-modal` form interception.
- 7686abb: Remove the relic `claude-code` built-in tool. Use `type: llm-prompt` (or legacy `type: claude-code`) instead.

  The `claude-code` built-in tool was marked in-source as "Backcompat tool for v0.15 type:claude-code nodes" and had zero callers in any in-tree agent. It only existed as a UX device — the dashboard tool picker used `'claude-code'` as a sentinel string to drive a hidden `type` field on the form. This release deletes the built-in tool registration and replaces the picker entry with a synthetic `llm-prompt` option that submits `type: llm-prompt` directly. The "Analyze with LLM" Quick Start pattern follows.

  CLI `sua agent new` and `sua agent audit` now use the canonical `llm-prompt` spelling in prompts and output. The v1 agent schema accepts `'llm-prompt'` alongside the existing `'claude-code'` and `'shell'`. `docs/tools/claude-code.md` was removed (it's a node type, not a tool); `docs/tools.md` points readers at `type: llm-prompt` on the node.

  Authors who wrote `tool: 'claude-code'` in YAML by hand will now see a "Tool not found in registry" error at run time. Mitigation: replace with `type: llm-prompt` (or `type: claude-code` legacy alias) and an inline `prompt:`.

  Closes the LLM-prompt unification plan (PR 3 of 5). PR 5 will surface installed providers in the tool catalog.

- 8892cfa: Three improvements to the Improve-layout drafting flow:

  - **YAML-parse retry**: the orchestrator's drafting phase now retries on a YAML parse failure (e.g. inline `python3 -c "…"` shell command without a `command: |` block scalar) the same way it retries on critic failures. The parse error is appended to FOCUS as critic-style feedback. Up to 3 attempts per drafter. Same retry path also covers the id-mismatch case (drafter drifts off SUGGESTED_NAME).
  - **Wider wizard modal**: the Improve-layout modal grows from 640px to ~960px (capped at 95vw). The Cancel / Apply layout / Draft+apply action row had buttons too close together in the narrow modal; the wider modal makes mis-clicks between "Update plan" (refine block) and "Apply layout" (action row) far less likely.
  - **Auto-run on landing**: `/agents/build/commit` now fires a single fire-and-forget run for each newly created agent immediately after `createAgent` succeeds. The user's first view of the dashboard shows real output instead of empty placeholders. Failed auto-runs surface as a normal failed-run row that the user can re-trigger with inputs.

- 62ffca4: Wire the build-orchestrator drafters into the critic-retry loop so the structural critic gets a second pass instead of leaking broken drafts to the user.

  - **New critic check**: `critiquePlan` now flags `ai-template` widgets that use nested placeholder paths (`{{outputs.X.Y}}` or `{{item.X.Y}}` inside `#each`). The placeholder substituter only supports single-level paths; nested paths leak the literal `{{…}}` into the rendered tile. Each offending placeholder produces a concrete error with guidance to flatten the value into a scalar top-level output.
  - **Per-drafter retry**: after a drafter completes successfully (autoFix + parseAgent), the orchestrator wraps the draft in a synthetic single-agent BuildPlan and runs `critiquePlan` on it. If errors are found and the drafter still has retry budget (up to 3 attempts), the orchestrator kicks off a fresh drafter run with the critic feedback appended to FOCUS. After exhausting retries, the critic errors surface as the failure reason instead of accepting a broken draft.
  - Same logic applies to single-spec drafters (the Improve-layout `/agents/draft-one` path).

- 7d21677: Add a critic check + drafter prompt guidance so external `<img>` URLs in ai-template widgets don't get blocked by the page CSP.

  - **Critic**: `critiquePlan` now scans each ai-template for `<img src="https://HOST/...">` references. Hosts not declared in the agent's `permissions.imgSrc` (or matched by a wildcard like `*.example.com`) become critic errors. The per-drafter retry loop feeds them back so the drafter adds the missing host on the next attempt.
  - **Drafter prompt**: explicit STRICT rule with examples — when a template references external image URLs, declare each host in `permissions.imgSrc`. Wildcards supported.

  Closes the symptom where a drafted agent rendered with broken images and the browser console showed "violates the following Content Security Policy directive: img-src ..." (`www.thecocktaildb.com` reported).

- d6f9872: Output Widget editor: edit `table` field columns inline (no more YAML-only round-trip).

  Each `type: table` field now expands a sub-table with one row per column (Column key / Label / Format / Href key / Text key-or-literal / delete). The Format dropdown toggles between `text` and `link`; switching a field's type to `table` seeds an empty column row so the schema validator doesn't immediately reject. Removing a column doesn't reshuffle indices — the parser skips gaps. `href`/`text` are only saved when format=link (schema would reject them on text columns).

  The previous-version preservation from #287 still kicks in when the form posts no columns for an existing table field (so non-dashboard callers — CLI/MCP/custom integrations — don't get destroyed), but form-posted columns now win whenever they're present, which is what makes the editor actually editable.

  Controls (`sort` / `filter` / `paginate` / `replay`) and `actions` are still YAML-only to edit; those get their own follow-up. They're still preserved across saves per #287.

- be43277: Output Widget editor: edit all 6 `controls` types inline (sort / filter / paginate / replay / field-toggle / view-switch) plus the `actions` array.

  Phase 2 of the editor-UI-for-table-things work after #288 (columns editor). A new collapsible Controls section between Fields and Interactive renders one bordered row per control with the type-select up top and per-type inputs below. The active type's inputs show; the rest are hidden but still SSR'd so toggling the type select via JS just swaps visibility (no rebuilds).

  - **sort** / **filter** / **paginate**: array name + columns (csv) + per-type knobs (default `col asc`, placeholder, pageSize). Pair with `type: table` fields by sharing the array name.
  - **replay**: optional label + optional inputs subset (csv). Re-runs the agent inline. The auto-synthesised replay from interactive mode still applies when none is declared.
  - **field-toggle**: label + toggleable fields (csv) + default (shown / hidden).
  - **view-switch**: label + views JSON (rarest type — nested `[{id, fields[]}]` edited as JSON in a textarea for now) + default view id.

  Also adds an Actions editor (POST buttons used by `diff-apply` widgets) with `id` / `label` / `endpoint` / optional `payloadField` inputs per row. Method is locked to POST per the schema.

  The editor now posts hidden `widget_controls_edited=1` and `widget_actions_edited=1` sentinels so the server can distinguish "user deleted all controls/actions" (honour deletion) from "non-editor caller silent" (keep #287's prev-version preservation). Empty / half-built control or action rows skip silently instead of failing schema validation. Malformed view-switch JSON drops just that row.

  After this PR the editor handles fields + columns + controls + actions end-to-end — no remaining YAML-only widget shapes.

  Tests cover all 6 control types parsing, the empty-edit sentinel path, the non-editor preservation path, malformed-JSON skip, plus action create / skip-on-missing-required / empty-edit / non-editor preservation.

- 60aa32f: Extend the "Improve layout" wizard to named user-dashboards (`/dashboards/<id>`).

  The wizard now appears on every named dashboard page alongside the existing Pulse surface. Same flow (suggestion pills → focus textarea → planner → clarifying questions → Apply), scoped to that dashboard's agent pool.

  Differences from Pulse:

  - **Curation rewrites dashboard config**, not `pulseVisible` flags. Named dashboards have no per-tile hide switch — agent membership is declared in `dashboard.layout.sections[].agentIds[]`. Apply replaces the section list with one derived from the plan's containers. Agents the planner didn't choose are REMOVED from the dashboard config. They stay in `/agents`; the **Add tile** button can re-add them.
  - **Agent metadata is filtered to the dashboard's pool.** The planner only sees agents currently in `sections[].agentIds`, not the whole catalog. Ranking and grouping happen within the dashboard's scope.
  - **localStorage key is per-dashboard.** Each dashboard's container arrangement persists under `sua-dashboard-layout-<id>`, isolated from Pulse and other dashboards.
  - **Copy adjusted.** "Will hide N agents" reads "Will remove N agents" with the recovery hint ("restore via Add tile"). The pre-plan blurb explains that agents not chosen will be removed from this dashboard.

  New routes (`packages/dashboard/src/routes/dashboard-layout-plan.ts`):

  - `POST /dashboards/:id/layout-plan/suggestions` — pills + dashboard-scoped agent metadata
  - `POST /dashboards/:id/layout-plan` — kicks off the layout-planner
  - `GET /dashboards/:id/layout-plan/:runId` — poll
  - `POST /dashboards/:id/layout-plan/commit` — rewrite `sections[].agentIds`; returns `{ removed, retained }`

  The shared `improve-layout-modal.ts` + `improve-layout.js.ts` now take a config (`endpointBase`, `storageKey`, `curateVerb`) so one modal serves both surfaces.

- d7af1b0: Improve-layout drafting now handles partial failures with a partial-success screen instead of treating any failure as all-or-nothing.

  Before: if 1 of 2 drafts failed, the wizard surfaced an error screen with only **Close** (lose the successful draft) or **Retry with feedback** (re-run everything including the one that already worked). Confusing.

  Now: when SOME drafts succeed and SOME fail, the wizard shows a partial-success screen listing each draft with its status (✓ / ✗), inline error for failed ones, plus three actions:

  - **Apply N drafts + layout** (primary) — commit just the successful ones and apply the layout.
  - **Retry all failed** — re-fire `/agents/draft-one` for every failed entry, leaving successes intact.
  - **Retry** (per-row) — re-fire one failed entry individually.

  All-failed (existing error screen) and all-succeeded (straight-through to commit) paths are unchanged.

- 5aa3853: Add "Retry with feedback" on the Improve-layout error screen.

  When the layout-planner emits an invalid plan (or the run fails for any other reason), the modal's error screen now offers:

  - The error message (plus a `<details>` block exposing the raw planner output, if any)
  - A bulleted list of schema-validation issues when applicable
  - A **Feedback for the planner** textarea, pre-filled with the validation issues as a hint
  - A **Retry with feedback** button

  Clicking retry re-runs the planner with the combined focus:

  ```
  <original focus>

  Previous attempt failed validation. Issues:
    - <issue>
    - <issue>

  User feedback:
    <textarea value>
  ```

  So the LLM sees exactly what schema rules it broke + the user's correction. Same mechanism the post-plan questions UI uses for clarifying answers.

- c7221dd: Wire the "Improve layout" wizard on `/pulse` — routes + modal UI + button.

  A new ✨ Improve layout button sits next to Edit layout on the Pulse page. Clicking it opens a modal that:

  1. Fetches state-derived suggestion pills (from PR #307's `computeLayoutSuggestions`) plus pre-computed agent metadata.
  2. Renders pills above a free-form FOCUS textarea — clicking a pill prefills the textarea so the user can edit before submitting.
  3. Submits to the new `layout-planner` agent (from PR #306), polls the run, then renders the structured `LayoutPlan` (from PR #305) inline: top agents with rationales, proposed containers, and optional clarifying questions.
  4. Lets the user answer questions to refine the plan ("Update plan" re-runs with appended context), or click **Apply layout** to write the proposed containers to `localStorage` and reload `/pulse`.

  Four new endpoints under `/pulse/layout-plan/`:

  - `POST /suggestions` — pills + agent metadata for the modal.
  - `POST /` — kicks off the layout-planner agent with `focus`, `currentLayout`, optional `agentMetadata`. Returns `{ runId }`.
  - `GET /:runId` — polls the run; extracts `<plan>{...}</plan>`, validates against `layoutPlanSchema`, returns the typed plan or validation errors.
  - `POST /commit` — telemetry no-op for parity with `/agents/build/commit`. Reserved for future server-side layout persistence.

  No critic-retry loop in v1 (PlannerLoopRunner is build-plan-shaped); if the planner emits invalid YAML the modal shows validation issues and the user re-submits.

  Closes the dashboard-layout-improvement plan at `~/.claude/plans/how-would-you-improve-joyful-wadler.md` (PR 4 of 4).

- ab118ec: dashboard: in-place "+ Add tile" modal on /dashboards/:id

  When a user dashboard is in Edit Layout mode, each section grows a "+ Add tile" button next to its title. Clicking it opens a searchable picker: a "Suggested" row ranked by last-fired recency, then the full grid of signal-bearing agents. Picking one POSTs to the existing tile-append route with returnTo=live and lands back on the live dashboard. Empty sections now render in edit mode so users can fill them in place without bouncing to /edit.

- 94e607b: CSV integration kind with auto-generated read + count tools (PR 4.A)

  First slice of PR 4 of the Settings → Integrations workstream. Replaces
  the connectors-v0.17 plan's "CSV connector" with a `kind: csv`
  integration backed by sua's existing tool dispatch.

  How it works:

  1. Add a CSV integration at `/settings/integrations?tab=csv` pointing
     at a file. On save, sua reads the header + first 200 rows, infers
     per-column types (number / boolean / date / timestamp / string),
     and stores the snapshot on the integration row.

  2. Two tools are auto-generated per CSV integration:

     - `csv.<id>.read` — fetch matching rows (optional `where` filter,
       `limit` cap), returns coerced values + row count.
     - `csv.<id>.count` — count matching rows without fetching.

  3. Agents reference them via the standard `tool:` field on a node.
     The executor finds them through the same lookup chain as built-in
     tools (built-in → connector-generated → user/MCP), so no new
     dispatch branch.

  Constraints in this slice:

  - File size capped at 16 MiB; bigger CSVs should land as `kind: postgres`
    in PR 4.B.
  - No streaming yet — full file read per tool call.
  - Output schemas declare `array` / `object` types but don't carry
    per-column item schemas; rich schema-aware template validation lands
    in PR 4.C.

  Tests: +22 across 3 new files (parser, driver, generated tools, route).
  Total 1228 → 1230 passing.

- c05f260: Postgres integration kind with auto-generated find/find-one/count tools (PR 4.B)

  Second slice of PR 4 of the Settings → Integrations workstream.
  Adds a `kind: postgres` integration that introspects
  `information_schema` once at add-time and synthesises three read-only
  tools per table:

  - `postgres.<id>.<table>.find` — typed `where` / `order_by` / `limit`
  - `postgres.<id>.<table>.find-one` — single row
  - `postgres.<id>.<table>.count` — `COUNT(*)` with optional `where`

  How it works:

  1. Paste the DSN into Settings → Secrets (e.g. `DATABASE_URL`).
  2. Add a Postgres integration at `/settings/integrations?tab=postgres`
     referencing that secret name + the schemas to introspect (default
     `public`).
  3. On save, sua opens a connection, walks `information_schema.columns`
     - the primary-key view, builds a typed snapshot, stores it on the
       integration row, and closes the probe pool.
  4. At run time, agents reference any synthesised tool via the standard
     `tool:` field. The DSN is re-read from the encrypted secrets store
     per execute call; a pooled `pg.Pool` (1 per integration, 2 conns
     max, 30s idle) handles the actual queries.

  Trust posture:

  - Identifiers (schema, table, column, order_by direction) are
    validated against the snapshot before splicing into SQL — no quoted
    or mixed-case identifiers in this slice.
  - `where` keys are checked against the table's column list before any
    query runs; values are bound, never interpolated.
  - DSN never leaves the encrypted secrets store + the per-integration
    pool's memory.
  - Read-only: no insert / update / delete tools. Writes deferred to
    PR 4.D.

  Adds `pg ^8.20.0` as a runtime dependency. ~200 KB, well-maintained,
  zero new transitive secret-shaped strings.

  Tests: +18 (mapColumnType unit cases, generated-tool synthesis +
  resolution + execute error path, dashboard tab render + missing-DSN
  error). Plus 3 live tests that exercise introspection +
  parameterised reads against a real Postgres — gated by `PG_TEST_URL`,
  skipped without it.

  Total 1230 → 1242 passing (12 net new actually run; 3 skipped pending
  CI Postgres service).

- 021f499: Schema-aware save-time template validation (PR 4.C of Integrations).

  Catches typos in `{{upstream.<node>.<path>}}` references at agent save
  time instead of resolving silently to "" at run time. `ToolOutputField`
  now carries optional `items` / `properties`, and the CSV / Postgres
  generated tools populate per-row column schemas from their snapshots —
  so `{{upstream.fetch.rows.0.emial}}` fails save in the dashboard YAML
  editor with "Property 'emial' not found … Did you mean 'email'?".

  The validator is lenient: when a tool's output schema doesn't declare
  `items` / `properties` (legacy user tools, untyped built-ins), the
  walker stops without reporting. Field paths are only flagged when the
  schema is rich enough to disprove them.

  `parseAgent()` keeps its single-argument signature — the new
  `validateAgentTemplatePaths(agent, { resolveTool })` is opt-in and
  runs from the dashboard's YAML save handler, which already has the
  integrations + tool registries in scope.

- 1295333: `kind: sqlite` integration with auto-generated find / find-one / count tools (PR 4.E of Integrations).

  Point at a local SQLite file from Settings → Integrations → SQLite. sua
  introspects every base table via `sqlite_master` + `PRAGMA table_info`
  and synthesises three read-only tools per table:

  - `sqlite.<id>.<table>.find` — typed `where` / `order_by` / `limit`
  - `sqlite.<id>.<table>.find-one` — single row (or null)
  - `sqlite.<id>.<table>.count` — COUNT(\*) with optional `where`

  Mirrors PR 4.B's Postgres connector but with no DSN, secret, or pool —
  the file path is the whole config and `node:sqlite` (Node 22+ built-in,
  already used throughout) is the driver. Per-row schemas populate
  `rows.items.properties` so PR 4.C's save-time template validation
  catches column typos on SQLite-backed agents the same way it does on
  Postgres-backed ones.

  Read-only by default. Tables whose names don't match the safe
  identifier rule (lowercase letters/digits/underscores) are skipped at
  introspection time so no SQL injection vector reaches the generated
  tools.

- 16e9a9a: Settings → Integrations (PR 1 of 4): storage + UI for slack/webhook/file

  Adds the `integrations` SQLite table + `IntegrationsStore` (core),
  context wiring (dashboard), and a real `/settings/integrations` page
  that replaces the "coming in a later release" placeholder. Today
  covers three kinds — `slack`, `webhook`, `file` — lifted from the
  per-agent notify handlers so the model carries over unchanged.

  Each integration row stores names only: kind-specific config (URL,
  path, channel, mention, method) and `secretRefs` pointing at the
  encrypted secrets store. Actual secret values never touch the
  integrations table.

  Per-agent notify still reads its existing inline handlers; PR 2 of
  this series adds the `handlers[].integration: <id>` form so agents
  can reference these by id. PR 3 adds OAuth (loopback callback + Gmail
  kind). PR 4 folds the connectors-v0.17 plan in as `kind: csv` /
  `kind: postgres`.

  Includes 8 store tests (round-trip, slug validation, list-by-kind /
  by-user / pack ownership, cascade-delete, JSON corruption fallback)
  and 5 dashboard route tests (render, add, slug rejection, duplicate
  guard, delete). Pack-owned integrations show but their Delete button
  is disabled — pack uninstall remains the path to remove them.

- 75763e6: Layout curation now correctly handles draft/archived agents and stops loading hidden signals on Pulse.

  Three connected fixes after live-testing the curation flow:

  - **Curation reaches draft/archived agents.** The commit endpoint previously skipped agents whose status was `draft` or `archived`, so any draft agent with `pulseVisible !== false` slipped through curation and re-appeared on Pulse via the auto-"Other" container in `widget-layout.js.ts`. The Pulse view itself doesn't filter by status — only by signal + pulseVisible — so curation now matches that exactly.
  - **Planner sees the same set Pulse renders.** `gatherAgentMetadata` lost its archived/draft filter for the same reason; it now agrees with the Pulse route's actual visibility rule. The planner no longer wastes `topAgents` slots on agents that can never render (those without a `signal:` block — `build-planner`, `agent-analyzer`, `agent-builder`, etc. — already got excluded via the `!signal` skip; this PR just keeps that invariant clean).
  - **Hidden-signals section is compact.** Previously every hidden agent rendered as a full tile inside a `<details>` block. Now the section is a one-line summary (`N signals hidden from Pulse`) with **Show all** + **Manage in /agents** buttons. The route also skips the expensive `buildTile()` call for hidden agents — they only contribute to a count.

- f60a468: Layout planner becomes curation, not just rearrangement.

  Previously the planner bucketed every visible agent — typically dumping the long tail into an "Other" container. That's not what users actually want when they invoke "Improve layout": they want the top ~12 agents surfaced and the rest hidden. This release makes that the default behaviour.

  Changes:

  - **Prompt** (`agents/examples/layout-planner.yaml`): capped \`topAgents\` at 12, explicitly told the LLM that anything not in a container will have its \`pulseVisible\` set to false, and forbade catch-all "Other" / "Misc" containers.
  - **Commit endpoint** (`POST /pulse/layout-plan/commit`): no longer a no-op. Walks the agent store, sets \`pulseVisible=false\` on any visible agent absent from the plan's containers, and \`pulseVisible=true\` on any container-mentioned agent that was previously hidden. System tiles (`_system-*`) are skipped. Returns \`{ hidden: string[], unhidden: string[] }\`.
  - **Modal UI**: the proposed-layout screen now shows a "Will hide N agents" `<details>` block listing the agent ids that will be hidden, between the containers and the Apply button. Apply waits for the server commit before reloading.

  Hidden agents remain restorable from the "hidden signals" details section below the Pulse grid — single click brings them back.

- 9d99976: Three layout-planner fixes after live testing.

  1. **Empty containers no longer render.** `widget-layout.js.ts` skips a container at render time if none of its tile ids resolve to a rendered tile in the DOM (e.g. the planner included no-signal agents, or a tile was hidden between sessions and its id lingers in the saved layout). Edit mode still shows empty containers so the user can drag.
  2. **Planner orders containers by glance-value.** Prompt updated: high-frequency / daily containers go near the top of the array (containers render top-to-bottom); engineering/admin/infra containers go lower; system tiles anchor either the very top or the very bottom, not the middle.
  3. **Planner explicitly told not to include no-signal agents in containers.** Belt-and-suspenders: even though `gatherAgentMetadata` already filters them, the prompt now spells out that an AGENT_METADATA entry without a `title` means the agent has no Pulse signal and placing it in a container leaves the container empty.

- ed71f4c: Add the `LayoutPlan` zod schema for the upcoming layout-planner agent.

  Parallel to `BuildPlan` from `build-plan-schema.ts`. Defines the structured output the layout-planner emits in a `<plan>…</plan>` wrapper: a `summary`, a ranked `topAgents[]` with one-line rationales and optional `suggestedSize`, proposed `containers[]` (label + tiles) that mirror the `sua-pulse-layout` localStorage shape, and post-plan clarifying `questions[]`.

  Strict-mode validation catches the common LLM mistakes: duplicate tiles across containers, duplicate container labels (case-insensitive), duplicate topAgent ids. Loose enough that container tiles can reference any agent (not just topAgents) so lower-ranked agents can be placed without promotion.

  This PR is schema-only — no agent or UI yet. Part 1 of 4 in the dashboard-layout-improvement plan at `~/.claude/plans/how-would-you-improve-joyful-wadler.md`.

- 8a09dab: Allow system tiles (Pulse-synthetic widgets) in `LayoutPlan.containers.tiles`.

  The schema's tile regex was `/^[a-z0-9][a-z0-9_-]*$/` — letter/digit first. But Pulse's system tiles (Runs Today, Failure Rate, Avg Duration, Agent Count) use a leading underscore by convention (`_system-runs-today`, etc.) to mark them as synthetic. When the layout-planner saw them in `CURRENT_LAYOUT` it correctly placed them in containers, but validation rejected the plan.

  Tiles now match `/^_?[a-z0-9][a-z0-9_-]*$/` — the leading underscore is optional. The `topAgents.id` regex stays unchanged: that field is real agents only.

  The layout-planner prompt was also updated to teach the LLM the new rule explicitly (and to include a system-tile container in its in-prompt example).

- 621939d: Layout planner can now surface installed agents that aren't on the current dashboard.

  The Improve-layout wizard previously only rearranged agents already on the surface (curation-only). It now also sees the rest of your installed catalog as `available` agents and can bring them onto Pulse or a named dashboard. The `LayoutPlan` schema gains an optional `toAdd[]` field; the wizard shows a "Will add N agents" details panel alongside the existing "Will hide/remove N agents" panel. Drafting brand-new agents that don't exist yet is still the job of build-planner / "Build from goal".

- 3a0f43d: Add the `layout-planner` agent.

  Single-node `type: llm-prompt` agent at `agents/examples/layout-planner.yaml` that reads `CURRENT_LAYOUT` + `AGENT_METADATA` + an optional `FOCUS` statement and emits a structured `LayoutPlan` JSON (introduced in the previous PR) wrapped in `<plan>...</plan>` tags. The prompt teaches the LLM the ranking rules (FOCUS-first, then a recency × reliability × frequency combination), the container grouping rules (1–6 containers, unique labels, each tile in exactly one container), and when to emit clarifying questions (FOCUS empty → ask about ranking heuristic).

  The route handler + UI come in a later PR; this commit is the agent and a regression test that locks the prompt's embedded `<plan>` example to the schema. Editing the prompt's example out of sync with the schema fails the test.

- 07f661d: Layout planner can now suggest brand-new agents to draft (Path B-lite), and the wizard stops calling installed agents "new".

  Two changes:

  - **Prompt vocabulary** — the planner used to call already-installed agents "new" when surfacing them via `toAdd`, which implied fresh code. It now says "from your catalog" / "already installed" and reserves "new" for agents that don't exist yet.
  - **`needsNew[]`** — a new optional field on `LayoutPlan` for brand-new agent specs (`purpose` + optional `suggestedName`). When FOCUS asks for an agent that doesn't exist anywhere, the planner emits the spec here instead of inventing an id. The wizard renders a "Draft N new agents" section with a link to Build from goal; drafting happens out-of-band, and the user re-runs Improve layout afterward to surface the new agent. Schema validates that needsNew names don't collide with container tiles or `toAdd[]`.

  Full inline build-planner orchestration (Path B proper) is still deferred.

- abed134: Layout planner can now draft brand-new agents inline via build-from-goal hand-off (Path B), and stops speculatively adding agents you didn't ask for.

  Two changes:

  - **Inline drafting** — clicking "Draft these agents" in the Improve-layout wizard no longer dumps you on /agents. It opens the Build-from-goal modal pre-filled with the synthesized goal, you go through the full critic-loop / questions / YAML-edit / commit flow there, and when you commit, you're returned to the layout wizard with the freshly drafted agents merged into the plan in a "Newly drafted" container. One click to Apply layout finishes the job. State is persisted in `sessionStorage` (1h TTL) so the original plan survives the round-trip.
  - **Conservative `toAdd`** — the planner used to surface available agents whenever they "fit the layout" or "filled an obvious gap", which caused unwanted additions like `system-health` showing up on dashboards where the user only asked for a couple of new agents. The prompt now requires FOCUS to explicitly name a topic or agent before anything in `toAdd` is allowed. Empty `toAdd` is the default.

  The build-from-goal modal is now also rendered (hidden) on `/pulse` so the hand-off works there too.

- 0a88b2e: Constrain the layout-planner to curation-only and require plain-text question fields.

  Two prompt fixes after live testing:

  1. **Scope.** The planner was hallucinating a "suggest new agents" capability. It would list agents from training data (or from the prompt's own example agent ids) and claim to be adding them to the dashboard — but the commit endpoint can only curate within the agents already on the surface (`AGENT_METADATA`). The prompt now explicitly says: _you cannot suggest agents that aren't in `AGENT_METADATA`_. If the user's FOCUS asks for new agents, the planner emits a question redirecting them to Add tile / Build from goal. The `summary` field is also constrained — never claim to "suggest N new agents".
  2. **Question format.** Clarifying questions were rendering as raw `**markdown**` and unbroken text because the LLM was stuffing multi-line bulleted catalogs into a single question's `text` field. The renderer (correctly) escapes HTML. Prompt now requires: one short plain-text question per entry, no markdown, no line breaks, alternatives live in `options[]` for select-style rendering — not enumerated inside `text`.

- ec676a1: Add `computeLayoutSuggestions()` helper for the Pulse "Improve layout" wizard.

  Pure heuristic — no LLM. Takes agent metadata + the current layout JSON and returns up to 5 suggestion pills for the modal's pill row. Three dynamic (state-derived) pills come first when triggered:

  - **Surface failing agents** — when one or more agents have `successRate < 0.5` and have run in the last 30 days.
  - **Group ungrouped agents** — when two or more agents aren't in any container.
  - **Hide stale agents** — when one or more agents haven't run in 30+ days.
  - **Combine monitoring agents** — when two or more agents match `monitor|health|uptime|watch|alert|status|ping|check` in their id or title.

  Dynamic pills are capped at 3 (ordered by signal strength); static fillers (Group by topic, Rank by reliability, Surface daily-run, Pin top 5 reliable) fill the remaining slots up to a 5-pill cap. Each pill has a short `label` for the chip and a longer `prompt` that fills the FOCUS textarea on click — dynamic pills include the affected agent ids inline so the downstream layout-planner can act directly.

  Routes and modal UI come in the next PR; this commit is unit-test-only.

- 5d10f71: Expose per-node LLM options (provider, model, maxTurns, allowedTools) on the add-node and edit-node forms.

  The schema has always honored these fields, but the dashboard only exposed `provider` (and only on the edit-node page). Authors who wanted to allowlist tools the LLM could invoke (Read, Write, Edit, web-search, MCP tools) or override the model had to drop to YAML. The deleted `claude-code` built-in tool used to surface them via its `toolInputs` schema; PR #297 inadvertently took that affordance with it.

  A new `renderLlmOptions()` helper sits alongside the Prompt textarea on both forms, inside the same `data-node-field="llm-prompt"` container so the existing tool-picker show/hide logic catches it. A matching `parseLlmOptions()` reads the form body and persists fields on the node. Empty fields are omitted (no spurious `model: ''` in YAML).

- af5edb9: Add `llm-prompt` as the canonical node type for LLM-prompt steps; keep `claude-code` as a legacy alias.

  The `claude-code` spelling was load-bearing in agent YAML even though the field has always been provider-agnostic (the actual CLI is chosen by `provider:`). This release teaches the schema, dispatcher, and UI to accept both spellings interchangeably. A new `isLlmPromptType()` helper consolidates the recognition logic. Every existing agent loads byte-identically — no migration required.

  Authors writing new agents can use either spelling. Future releases will migrate the example agents and docs to `llm-prompt`.

- 81dd182: Single source of truth for LLM provider metadata.

  Adds `PROVIDERS` registry + `ProviderDef` type in `@some-useful-agents/core`, with one entry per supported CLI (display name, binary, version argv, prompt argv). `detectLlms()` and `invokeLlm()` now iterate the registry instead of hard-coding two branches. The dashboard's "New Agent" form reads provider display names from the same registry, and its TYPE radio is relabeled "LLM Prompt — runs an LLM prompt — you have {list} installed" so users see which CLIs are actually on PATH. Public API of `detectLlms` / `invokeLlm` is unchanged; this PR is preparation for adding more providers without a parallel call path.

- bf7d317: `startMcpServer` now accepts `port: 0` and returns the kernel-assigned port on the handle.

  `McpServerHandle` gains a `port` field — same as `options.port` when the caller asked for a specific port; the OS-assigned port when the caller passed `port: 0`. The Host/Origin allowlist is rebuilt after the listen completes so requests against the bound port are accepted.

  Internal: tests in `packages/mcp-server/src/server.test.ts` now use this, eliminating the random-port-pool collision that surfaced as intermittent `UND_ERR_SOCKET` flakes on CI.

- 262ffa9: Replace Gmail OAuth with a generic `mcp-tool` integration kind

  Reverses #264 (OAuth + Gmail) in favour of delegating OAuth-backed
  services to already-connected MCP servers. Claude (and Claude Desktop)
  already handles the OAuth handshake for Gmail, Calendar, Drive, Notion,
  Linear, etc.; sua doesn't need to re-broker.

  **Removed:** every Gmail / OAuth code path — `packages/core/src/oauth/`
  (PKCE + state store + Google driver), the `/oauth/callback` +
  connect/disconnect routes, the `gmail` notify handler, the Gmail setup
  guide in the integrations UI, and all the supporting tests. No
  external API surface left.

  **Added:** an `mcp-tool` integration kind that pairs an MCP server
  (from `/settings/mcp-servers`) with a specific tool name + optional
  default inputs. Notify handlers reference it via:

  ```yaml
  notify:
    on: [failure]
    handlers:
      - type: mcp-tool
        integration: user:gmail-via-mcp
        inputs:
          body: "Run {{run.id}} failed: {{run.error}}"
  ```

  The dispatcher merges `default_inputs` from the integration row with
  the handler's `inputs` (inline wins), runs template substitution for
  `{{vars.X}}`, `{{agent.id}}`, `{{run.id}}` etc., and calls
  `callMcpTool()` against sua's existing pooled MCP client — the same
  primitive in-DAG MCP tool nodes use, so notify dispatch reuses the
  connection pool.

  **Trust model:** zero new secret surface. The MCP server's auth lives
  in `mcp_servers.env_json` / `url` already; sua never touches the
  underlying credentials.

- 7f41ba0: Migrate example agents, docs, and the `/agents/new` form to the canonical `type: llm-prompt` spelling.

  All eleven `agents/examples/*.yaml` (and `agents/local/claude-hello.yaml`) now use `type: llm-prompt` instead of the legacy `type: claude-code`. The dashboard "New Agent" form, its POST handler, and the related copy emit `llm-prompt` for newly-created agents. `build-planner.yaml`'s prompt template and `agent-builder.yaml` / `agent-analyzer.yaml`'s in-prompt guidance text were updated so generated/reviewed agents also use the new spelling.

  Existing agents on disk that say `type: claude-code` continue to load byte-identically (alias preserved from PR 2). ADR-0023 records the decision and consequences. `docs/agents.md` carries the one-paragraph alias note.

  No runtime behavior changes.

- ee8cd9c: notify: handlers can reference a saved integration by id

  PR 2 of 4 of the Settings → Integrations workstream. Notify handlers
  gain an optional `integration: <id>` field. When set, the dispatcher
  resolves the named integration from #262's store at fire time, merges
  its config (webhook URL secret, channel, path, etc.) into the handler,
  and unions the integration's `secretRefs` into the resolution bag so
  agents no longer need to repeat them in `notify.secrets`.

  Inline fields on the handler still override the integration's config
  — useful when one agent wants a different channel than the saved
  default. Missing or wrong-kind integration logs and skips the
  handler, never failing the run (matches the existing reliability
  contract).

  YAML schema gates: each handler must EITHER reference an integration
  OR carry its kind-specific required inline fields (webhook_secret /
  url / path). Existing YAML keeps working unchanged.

  Dashboard: the per-agent Notify card now shows a per-handler
  "Integration" dropdown listing matching kinds (with a link to manage),
  plus a fall-through "Inline config (legacy)" option.

  Tests: +5 dispatcher tests covering successful resolution, inline
  overrides, missing-integration skip, kind-mismatch skip, and the
  integration-driven secret union.

- 68174cc: OAuth infrastructure + Gmail integration kind (PR 3 of 4)

  Third PR of the Settings → Integrations workstream. Adds a generic
  OAuth flow (PKCE + S256 challenge, in-memory state map, single-use
  state consumption, stable `/oauth/callback` redirect_uri on the
  dashboard's existing port) and uses it to land the first OAuth-backed
  integration kind: `gmail`.

  How it works:

  - User creates a Google Cloud OAuth client (type "Desktop app"),
    registers `http://127.0.0.1:3000/oauth/callback` as a redirect URI.
  - User adds the client_id + client_secret in `/settings/secrets`.
  - User creates a Gmail integration in `/settings/integrations` and
    clicks **Connect Google**. The dashboard generates state + PKCE
    verifier, redirects to Google consent, and on callback exchanges
    the code for tokens.
  - Refresh token is stored in the encrypted secrets store as
    `<INTEGRATION_ID>__REFRESH_TOKEN`. The integration row gains
    `connected_account` (the user's email), `connected_at`, and
    `refresh_token_secret` so handlers know what to read.
  - Notify handlers of type `gmail` reference the integration by id +
    the inline per-message fields (`to`, `subject`, `body`). The
    dispatcher refreshes the access token per send and calls Gmail's
    messages.send API. Disconnect deletes the refresh token + clears
    the connected state.

  Tests: +18 (PKCE, state store, OAuth route flow, dispatcher Gmail
  handler success + missing-connection failure). Total 1218 passing.

- 2c82a16: dashboard: Permissions card on agent Config tab

  Surfaces the `permissions.imgSrc` allowlist (added in #256) on the
  agent detail Config tab. New POST /agents/:id/permissions route accepts
  a newline / comma / space-separated host list, normalises (lowercases,
  strips https:// + paths + ports so users can paste full URLs), dedupes,
  validates each entry against the host regex, and creates a new agent
  version. Empty input clears the allowlist. Pack-installed agents pick
  up the same UI — edits become a local user-version on top of the pack.

- d83b9ce: Planner refactor PR 3 — cross-run memory.

  The planner now reads prior committed plans for similar goals before composing a new one. Implements the `understand` phase of the loop principles: before reaching for the LLM, retrieve what worked last time and pass it as context.

  - **`PlannerMemoryStore`** — new SQLite table `planner_memory` (one row per committed plan with goal + tokens + intent + plan_json + attempts).
  - **`findSimilarCommittedPlans`** — bag-of-words Jaccard retrieval; intent equality as a hard filter when known. Ranked by similarity DESC then attempts ASC (prefer plans that took fewer planner tries — cheap quality signal). MVP-level; embeddings replace this when N grows.
  - **`formatPriorPlansBlock`** — renders top-K candidates as a `<priorPlans>` block (score / attempts / intent / goal / newAgent ids). Compact summary, not full plan JSON.
  - **Initial kickoff retrieves by goal only** (intent not yet known); **retries retrieve by goal AND intent** (sharpest signal once classified).
  - **Commit hook writes** to memory when the user clicks Commit on the wizard. Only when something actually landed AND telemetry has goal+intent.
  - **Build-planner prompt** acknowledges `<priorPlans>` — prefer reuse when patterns match, ignore when they don't.
  - **Escape hatch**: `SUA_PLANNER_MEMORY_DISABLED=1` env var skips memory injection without a redeploy.

  15 new tests across memory-store, retrieval, and runner. Third of a planned 4-PR refactor.

- a1f854f: Planner refactor PR 1 — extract the inline critic-retry from run-now-build into a `PlannerLoopRunner` class with named phases (observe / evaluate / reflect / compose / done / failed). Behaviour-equivalent.

  The extract → parse → schema-validate → autofix → critic → maybe-retry sequence used to live inline at run-now-build.ts:820-950. It's now in `packages/core/src/planner-loop/{types,primitives,runner}.ts`. Each primitive is a small TS function; the runner orchestrates them and emits a uniform `LoopStepRecord` per phase so PR 2 can drop a smoke-run eval next to the critic and PR 3 can add cross-run memory without churning the dashboard route.

  No user-visible change. Tests cover the 9 distinct paths through the runner (no plan, JSON parse fail, schema invalid, fallback to nodeExecResult, critic pass, critic fail with retry, critic fail with budget exhausted, retry-spawn-fails, autofix invocation). First of a planned 4-PR sequence (see plan).

- bd29502: Planner refactor PR 2 — smoke-run eval + structured step log.

  After PR 1 named the planner's loop phases, this PR makes "validated, not just produced" real:

  - **`smokeRunNewAgents(plan, ctx)`** — runs `parseAgent` on each newAgent then a per-agent `validateOnly()` that catches runtime gotchas the structural critic and zod schema can't see: shell `tool:` refs that aren't in the known-tools catalog, `signal.mapping` fields naming an output key the agent doesn't declare, typed-widget field names not matching declared outputs.
  - **`PlannerLoopStepLogStore`** — append-only SQLite table `planner_loop_steps` (one row per primitive invocation per attempt). Persisted from the dashboard route after each `loopRunner.advance()` so per-run "what did the planner actually do" can be reconstructed from a single SELECT.
  - **Telemetry columns** — `smoke_run_status` and `smoke_run_errors` added to `planner_telemetry` (PRAGMA-guarded ALTER, safe on existing DBs).
  - **Combined feedback** — when both critic and smoke flag issues, both blocks are appended to the GOAL on retry so the planner sees the full picture.

  The dashboard route now threads `loadKnownToolIds` (builtins + user tools) into the runner. Smoke-flagged retries surface as `smokeErrors: [{ agentId, errors[] }]` alongside `criticErrors` in the wizard's polling response.

  19 new tests across smoke-eval, step-log-store, and runner. Second of a planned 4-PR refactor (see [plan](/.claude/plans/i-need-to-refactor-peaceful-salamander.md)).

- 5787f35: v0.21.0 — integrations, the Improve-layout wizard, the build-from-goal orchestrator, and widget controls everywhere.

  This release rolls up the work since v0.20.0. Headline additions: a Settings → Integrations
  surface with CSV / Postgres / SQLite / Gmail (OAuth) kinds and auto-generated tools; the
  Improve-layout wizard on Pulse and any named dashboard (Path A adds installed agents, Path B
  drafts new ones inline); the build-from-goal planner split into a `goal-surveyor` +
  per-fragment `agent-drafter` (each behind its own critic) + `dashboard-designer` orchestrator;
  output-widget controls (`sort` / `filter` / `paginate` / `field-toggle` / `view-switch` / `replay`)
  that render everywhere and are restylable by the widget author; per-node Advanced LLM options
  (provider, model, maxTurns, allowedTools); and the `llm-prompt` node type (canonical rename of
  `claude-code`, with the old name preserved as an alias). Plus dashboard polish — tile first-run
  auto-execution, in-place "Run again", a one-click CSP image-allow modal, and a build stamp.

- 05b87a6: dashboard: schedule preset chips on agent → Config → Schedule

  The cron input stays as the source of truth, but a row of preset chips
  (Every 5m, Every 15m, Hourly, Daily 8am, Weekdays 9am, Mon 9am, Disable)
  sits above it. Click a chip to fill the input. The chip matching the
  current value highlights so it's obvious which preset is active. Typing
  a custom expression still works and the existing English preview
  ("Currently: Every day at 8:00 AM") validates the result.

- d2e3771: Layout planner: system tiles first, daily second. Pulse count differentiates agents from system widgets.

  Two clarifications after live testing:

  - **Canonical container order.** The prompt previously offered the LLM a choice between system-tiles-top and system-tiles-bottom. Made it prescriptive: system tiles always anchor the first container ("Health" / "Overview"), daily-glance content second, lower-frequency containers below. FOCUS can still override ("hide system stats"), but the default is now opinionated.
  - **Page count differentiates tile kinds.** The Pulse header previously read "16 signals, 28 hidden" which conflated 12 agent tiles with 4 synthetic system widgets. Now reads "12 agents + 4 system · 28 hidden" so the cap that matters to the user (agent count) is visible directly.

- 97a8c7a: First-class `table` field type for `dashboard` widgets — declare columns inline instead of writing `<table>` markup in an ai-template.

  A `table` field reads a top-level JSON array from the run output and renders a row-per-item HTML table over it. Columns are declared as `[{ name, label?, format?, href?, text? }]`; `format: link` columns wrap the cell in `<a href>` driven by `href` (per-row JSON key holding the URL) and `text` (per-row key OR literal label fallback like `"Apply →"`). Empty / missing arrays still render the header row plus a "No rows" caption so the column structure stays visible.

  Sort / filter / paginate `WidgetControl`s attach by sharing the field's `name` — same grammar and per-field URL state (`?ws_<field>=`, `?wf_<field>=`, `?wp_<field>=`) as ai-template widgets. Discovery catalog updated with the new field type, schema, and a complete example. Editor preview synthesises three sample rows so authors can see the column layout immediately.

- 8259154: ai-template `{{#each}}` blocks now support item-scoped `{{#if item.field}}` and `{{#unless item.field}}` conditionals.

  LLMs reach for the per-row form constantly when describing "show a link if the row has a url, else show a dash." Previously only `{{#if outputs.NAME}}` was supported, so authors who wrote `{{#if item.url}}` inside an `{{#each}}` got both branches rendered with raw `{{#if …}}` / `{{/if}}` tokens leaking to the page. The `#each` body rewriter now evaluates item-scoped conditionals per-iteration. Bare `{{#if item}}` (testing the whole item) also works, useful for primitive arrays. Single-level only, matching the `#each` body's non-greedy match. Discovery catalog updated to advertise the syntax.

- 99c9f5a: Surface installed LLM providers on the `/tools` catalog page.

  A new "LLM providers" section above the user / built-in tabs lists every entry in the provider registry with its installed status (resolved from `$PATH` at request time), version string, and "used by N agents" count. Counts walk every active agent's nodes, resolve each LLM-prompt node's effective provider (`node.provider ?? agent.provider ?? 'claude'`), and tally agents (not nodes) per provider — an agent with five Claude nodes counts once.

  Cards are read-only — no invoke button. The intent is _discoverability_: it gives back what the deleted `claude-code` built-in tool used to provide (a visible entry on the tools page) without re-introducing a parallel call path. Providers that aren't on PATH render with a "not on PATH" badge and the install hint instead of a version.

  Closes the LLM-prompt unification plan (PR 5 of 5). Adding a third provider in the future remains one entry in `PROVIDERS` from PR 1 — the catalog row appears automatically.

- 43f84c8: Widget controls (`sort` / `filter` / `paginate` / `view-switch` / `field-toggle` / `replay`) now render everywhere a widget appears — Pulse, home dashboard, interactive tiles, run detail, agent detail — and look-and-feel is owned by the widget author's `<style>` block instead of hardcoded inline styles.

  **Previously**: Pulse / home / interactive callers passed `controlState=undefined`, which short-circuited both the data-transform step (schema defaults like `sort.default: date desc` and `pageSize: 5` never applied) and the controls-row rendering. Tables looked unsorted/unpaged on every surface except the agent detail page.

  **Now**: those callers pass an empty `controlState ({})`. Schema defaults take effect on every surface; the interactive controls (chips, filter input, page nav) appear on every surface and respond to URL state the same way everywhere.

  **Styling contract**: control renderers emit semantic CSS classes (`.wc-row`, `.wc-group`, `.wc-chip`, `.wc-chip--active`, `.wc-clear`, `.wc-input`, `.wc-button`, `.wc-page-info`, etc.) with no inline `style="…"` attributes. The dashboard ships sensible defaults in `components.css`. Agent `<style>` blocks can override appearance — e.g. `<style>.wc-chip { background: var(--my-brand); }</style>` inside an `ai-template` template restyles the chips on that widget specifically.

  Two PRs ago (#278) we made the sanitizer preserve `<style>` blocks specifically so this pattern would work; this PR completes the loop.

- e1d0cf9: Per-field state for the `sort` / `filter` / `paginate` widget controls (PR #279 follow-up).

  **URL grammar changed**:

  - `?ws=<col>-<dir>` → `?ws_<field>=<col>-<dir>`
  - `?wf=<query>` → `?wf_<field>=<query>`
  - `?wp=<n>` → `?wp_<field>=<n>`

  Previously the global params applied to every control whose column list matched the named column. A widget with two `sort` controls on different arrays (e.g. `daily` + `models`, both with a `tokens` column) couldn't be sorted independently — `?ws=tokens-asc` re-shaped both. URL params now scope to the control's `field`, so each table keeps its own state.

  Also tightens the numeric-sort detector to handle common display formatting:

  - Currency prefixes (`$`, `€`, `£`, `¥`) — `"$711.63"` now sorts as `711.63`
  - Percent suffix (`%`) — `"95%"` sorts as `95`
  - Thousands commas (`"$1,234.56"`) — sorts as `1234.56`

  SI suffixes (`K`/`M`/`B`) are still treated as strings — those need magnitude logic that's a separate design call. Agents that want SI-formatted display + numeric sort should surface a parallel `<col>_raw` numeric column.

  **Breaking**: callers that hand-built `WidgetControlState` with scalar `sort` / `filter` / `page` fields must switch to `ReadonlyMap<field, …>`. Only the two dashboard route handlers and the test suite have this shape internally; agent YAML / outputWidget schemas are unaffected.

- 670a46e: Three new output-widget controls: `sort`, `filter`, `paginate`. They operate on top-level arrays in the agent's JSON output (e.g. `outputs.rows`, `outputs.daily`) and slot into the existing URL-driven control system — no client JS, full SSR.

  ```yaml
  outputWidget:
    type: ai-template
    template: <table>{{#each outputs.daily as d}}<tr>…</tr>{{/each}}</table>
    controls:
      - type: filter
        field: daily
        columns: [date, top_model]
      - type: sort
        field: daily
        columns: [date, cost, tokens]
        default: date desc
      - type: paginate
        field: daily
        pageSize: 10
  ```

  URL grammar:

  - `?ws=<column>-<asc|desc>` — sort
  - `?wf=<query>` — case-insensitive substring filter across the listed columns
  - `?wp=<n>` — 1-based page index

  Order applied per field: filter → sort → paginate. Changing sort or filter resets the page to 1; pagination preserves the active filter + sort. Empty arrays / non-array fields no-op gracefully. Stable sort, nulls last, numeric vs string sort inferred from the data.

  Only takes effect on `ai-template` widgets today — the typed widget renderers (`dashboard`, `key-value`, `raw`, `diff-apply`) don't surface array data yet. Coming next: a first-class `table` field type on `dashboard` widgets.

- dd4b78a: dashboard: Build-from-goal Plan-ready stage gets an "Update plan" form

  The Questions block now renders a textarea + **Update plan** button. Typing
  clarifications and clicking Update plan re-runs the planner with the
  original goal plus the appended answer, instead of asking the user to
  copy-paste their reply into the (now-hidden) goal field and start over.

  Also fixes a long-standing bug where clicking **Commit** threw
  `ReferenceError: runId is not defined` because `wireCommit` referenced a
  variable that lived inside an inner `.then` scope. The planner runId is
  now lifted to the outer planner-run scope so commit-time telemetry
  correlation works.

### Patch Changes

- c788a70: dashboard: + Add tile button is always visible on /dashboards/:id

  Previously the button was CSS-gated to edit mode, which made it
  invisible to users who hadn't clicked Edit Layout first. Adding a
  tile is non-destructive, so the gate was friction without payoff.
  The button (and the empty-section "no tiles yet" hint) now show
  without entering edit mode.

- eb7eff3: dashboard: + Add tile moves to the top action bar (was being DOM-wiped)

  The previous per-section + Add tile buttons were rendered server-side
  inside #dashboard-containers, but widget-layout.js.ts wipes that host
  on load and re-renders sections from a client-side layout. So the
  buttons disappeared the moment the page hydrated.

  Move to a single + Add tile primary button in the top action bar
  alongside Edit layout / Edit sections / Save as pack. Modal still
  posts to section 0 (server-side section structure isn't visible in
  the live view anyway).

- a53adad: dashboard: pin "Create new" tiles at the top of the add-tile modal

  Replaced the small footer link with two full tile cards pinned at the
  top of the modal: **+ Blank agent** (links to /agents/new) and
  **✨ Build from goal** (opens the AI wizard). Cards use a dashed
  border to distinguish from existing-agent tiles, then turn solid +
  primary-accented on hover. Search filter only affects the agent grid
  below — the create tiles stay visible regardless of query.

- f55afe7: Make the Advanced LLM options disclosure on `/agents/new` visually prominent.

  PR #301 added the disclosure but styled it `dim text-xs`, which made it nearly invisible to anyone scanning the form. Now it renders as a bordered card with a semibold summary, an inline secondary hint listing the four fields it expands, and a divider above the expanded content.

- f336d0f: `ai-template` widgets now populate `{{#each}}` blocks from JSON wrapped in prose or a markdown fence — the common shape for claude-code summarisers that lead with a note and emit their JSON inside a ```json fence.

  `renderAiTemplate` previously did a bare `JSON.parse(output)` to seed top-level arrays / objects into the outputs map. Anything other than pure JSON threw, the outputs map stayed empty for top-level keys, and `{{#each outputs.rows as r}}` blocks rendered to nothing. Scalar fields (`{{outputs.total}}`) survived via the existing `extractField` backfill, but arrays didn't — extractField returns stringified JSON, which breaks `Array.isArray()` inside `#each`.

  Switching to `parseJsonFromOutput` (same recovery logic PR #274 added for scalar extraction) closes the asymmetry: arrays + objects now reach the template from prose-wrapped JSON the same way scalars already did.

- 3564c8c: Bump the build-planner's `plan` node from `timeout: 180 / maxTurns: 3` to `timeout: 360 / maxTurns: 5`. Three-minute ceiling was too tight when the planner has to draft multiple agents in one shot (now common via the Improve-layout → Build-from-goal hand-off, which can hand off up to 3 needsNew specs at once). Six minutes / five turns gives Claude room to produce the full plan without router-level timeouts.
- 4b3087c: dashboard: clear edit-mode flag on pagehide

  Followup to #258. Edit mode persisted across navigations (from #242)
  so returning to a layout surface re-entered edit mode unexpectedly.
  `pagehide` now clears the flag — edit mode still survives drags
  within a page session, but resets when you actually leave.

- 1a993ed: Preserve the execute bit on `dist/index.js` across rebuilds so `sua` stays runnable when the package is `npm link`-ed.

  `tsc` emits plain files without `+x`, so a clean rebuild against a globally-linked install (`npm link @some-useful-agents/cli`) silently breaks the `sua` shim until the next `npm install`. The build script now chmods the bin file after compilation. No effect on fresh installs (npm sets the bit itself during install) or published tarballs (npm preserves it).

- 1d128d9: Wire `integrationsStore` / `variablesStore` / `toolStore` into the `sua workflow run` CLI so one-shot CLI runs can resolve csv/postgres/sqlite generated tools, user MCP tools, and `{{vars.*}}` references.

  Previously only the daemon's schedule path and the dashboard run-now path opened these stores; the CLI runner skipped them and any v2 agent that referenced a generated tool failed setup with "Shell node 'X' has no command" (the executor falls through to legacy shell dispatch when the tool can't be resolved). Mirrors the existing wiring in `cli/src/commands/schedule.ts`. Each store opens best-effort — absence just means that feature doesn't resolve, same as the schedule path.

- 2cc72d3: Fix blank TEMPLATE picker in the Configure-tile modal on dashboard pages.

  The Configure-tile modal builds its template grid from a `#pulse-template-registry`
  JSON island that was only emitted on `/pulse`. Named dashboards (`/dashboards/:id`)
  reuse the same modal but never rendered the island, so opening Configure tile there
  showed an empty Template section. The island is now emitted on dashboard pages too.

- c560c69: Eliminate the kickoff race in the build orchestrator by accepting a caller-supplied `runId` on `executeAgentDag`'s options. `kickoffAgentRun` now pre-generates the run-id via `randomUUID()` and passes it through instead of trying to look up the just-created run via `queryRuns(agentName, limit: 1)` — that pattern was racy whenever multiple parallel kickoffs targeted the same agent (e.g. three `/agents/draft-one` requests, three `agent-drafter` runs, same agent name → all three queries returned the same most-recent row → all three "drafts" polled the same run → 1 succeeded, 2 failed with "agent id already exists"). Serializing the kickoffs (the previous fix in #330) only patched the in-orchestrator fan-out; this fix addresses the root cause so parallel `/agents/draft-one` calls work too.
- e0cc472: Harden the dashboard CSS bundler against the foot-gun where bare `tsc --build` skips `scripts/copy-assets.mjs` and leaves `dist/assets/` empty, causing the dashboard to serve five `/* missing */` stubs and a styleless page.

  Two changes in `routes/assets.ts`:

  - `loadDashboardCss()` now falls back to `<pkg>/src/assets/<name>.css` when `<pkg>/dist/assets/<name>.css` is absent. Dev workflows that build with bare `tsc` still get a fully-styled dashboard.
  - If _both_ locations are missing for every source file, the loader throws on startup with a message naming the most common cause ("re-run `npm run build`") rather than silently serving stubs.

  Plus a new vitest assertion (`serves a real /assets/dashboard.css`) that fetches the route and rejects any `/* missing */` content. CI now catches the regression at test time instead of at the user's hard-refresh.

- 86acb69: Fix the "delete empty dashboard?" prompt not appearing after removing the last tile. The trigger is now server-driven: the dashboard route reads the `?emptyDashboard=1` redirect flag, confirms the dashboard is user-owned and genuinely has zero tiles, and renders `data-offer-delete="1"` on the host element. The client reads that attribute directly instead of re-parsing `window.location.search` (more reliable), and the check runs before the layout/drag setup so it fires even if that machinery hiccups on an empty dashboard. Verified end-to-end against a running daemon.
- bc0a0fd: Give dashboard users more in-app context, and fix stale node-type labels.

  Adds compact, dismissible one-line intros to the Home, Pulse, and Integrations
  surfaces (dismissal persists in localStorage), a guided empty state on Home when
  no agents exist, and an actionable "no runs yet" state on the agent Runs tab.
  Fixes rendered terminology: `llm-prompt` nodes are no longer mislabeled as
  `claude-code` (node badges, control-flow "goes to" badges, the shared type
  badge, the /nodes catalog, and DAG node coloring all show the canonical name;
  `claude-code` is still accepted as the legacy alias).

- 15a39d6: Replace the two stacked native browser prompts on dashboard tile removal with a single in-app confirm modal. Previously, deleting a tile in edit mode fired the `onsubmit` `confirm()` AND the edit-mode `beforeunload` "Leave site?" guard — two system dialogs for one action. Now: tile-delete forms use `data-confirm-modal`, intercepted by a styled in-app modal (reusing the existing `pulse-configure-modal` chrome); confirming sets an intentional-navigation flag so the `beforeunload` guard doesn't double-prompt. Any plain form submit in edit mode also clears the guard so deliberate server actions don't trigger the "Leave site?" dialog.
- ad94b09: Tile removal on a named dashboard now (1) shows a confirm dialog before deleting and (2) keeps the user on the dashboard view afterward instead of bouncing them to `/dashboards/<id>/edit`. The X button in the dashboard view passes `returnTo=dashboard` to the delete route; the edit-sections page's existing flow (which legitimately wants to land on /edit) is unchanged.
- 5f88fbd: Run an agent once when it's first added to a dashboard, so its tile renders in place.

  A tile shows nothing until its agent has produced output, so adding a never-run
  agent to a dashboard left a blank card until the next scheduled or manual run.
  Adding a tile now fires one fire-and-forget courtesy run when the agent has no
  prior run, so the tile populates on the next render. Skipped for agents that
  already have a run (no redundant work when re-added or shared across dashboards)
  and for community shell agents that require explicit audit confirmation.

- 28e7274: Two fixes after the build-planner split:

  - **agent-drafter prompt**: tell it explicitly that `field-toggle` / `view-switch` controls aren't allowed on `ai-template` widgets — the HTML template owns layout. Without this rule the drafter was producing YAML that failed schema validation on every draft when it picked `ai-template`.
  - **Improve-layout proposed-layout copy**: when the plan has both `toAdd` (installed agents) and `needsNew` (to-draft specs), the "Will add N" panel headline now says "Will add N installed + M new" so the user understands Apply layout only would land just the N installed; Draft + apply lands all N+M.

- ca7be93: Two fixes for the Improve-layout draft flow:

  1. **Drafter run-id race**: serialize the orchestrator's drafter kickoffs. `kickoffAgentRun` resolves the new run-id via `queryRuns(agentName, limit: 1)` which is racy when N parallel kickoffs target the same agent — all three queries returned the same most-recent run-id and downstream polling observed the SAME run thrice. Symptom: 3 parallel "drafts" all produced identical output (same id, "agent-id already exists" collisions on 2 of 3). Serializing the kickoffs (a few-hundred-ms overhead) makes each query see its own freshly-created run. The LLM calls themselves still run in parallel.

  2. **Speculative `toAdd`**: tighten the layout-planner prompt with a `BEFORE_TOADD_RULE`. Every id in `toAdd[]` must be justified by a quotable substring of FOCUS. "Complements the layout" / "is a useful default" are NOT valid justifications. Adds 4 concrete examples (when toAdd is allowed vs must stay empty). Addresses `system-health` showing up whenever the user looks at a monitoring-themed dashboard, even when they asked for 3 brand-new agents.

- 5e974c0: Two fixes for the agent-drafter:

  - **Drafter prompt**: explicit STRICT rule about multi-line shell commands needing the YAML literal block scalar (`command: |` with indented body). The drafter was producing inline `python3 -c "..."` blocks that broke YAML parsing with "Implicit keys need to be on a single line."
  - **Orchestrator parse**: run `autoFixYaml` on the drafter's output before `parseAgent`, matching what the commit endpoint already does. Absorbs common LLM YAML mistakes (camelCase outputs, double-brace templates in shell nodes, etc.) so drafts don't fail validation on issues the autofixer would have caught downstream anyway. The autofixed YAML is stored on the draft so commit doesn't re-fix.

- 7043bd7: Critic + drafter-prompt fix for broken Pulse tiles on drafted agents. Pulse renders a tile from `signal.template`, not `outputWidget.type` — so an agent that declares an `ai-template` outputWidget but sets `signal.template` to a named slot template (e.g. `text-image`) renders the empty slot template on the tile and the rich widget never shows. `critiquePlan` now flags this (outputWidget present + `signal.template !== 'widget'`) so the per-drafter retry self-corrects, and the drafter prompt spells out the rule with ✓/✗ examples.
- 123f65c: Tighten the agent-drafter prompt with an explicit rule: ai-template placeholder paths are SINGLE LEVEL ONLY. The substituter supports `{{outputs.NAME}}` / `{{item.FIELD}}` but NOT nested paths like `{{outputs.featured_duel.title}}` or `{{item.away_pitcher.name}}`. The discovery catalog already documented this, but the drafter kept generating nested paths and the literals leaked into rendered tiles. The rule now lives in the drafter's own prompt with paired ✗/✓ examples and guidance to flatten nested outputs in a post-processing node.
- 6f76270: dashboard: prompt before navigating away from edit mode

  Adds a `beforeunload` guard while a layout surface (Pulse, Home, or
  /dashboards/:id) is in edit mode, so accidentally closing the tab or
  clicking a nav link mid-arrange triggers the browser's "leave site?"
  dialog. Drag/resize/palette changes already persist to localStorage
  instantly — this is purely a guardrail against losing your visual focus
  while still in the middle of arranging tiles. Browsers ignore the
  returned string and show their own generic dialog text.

- bd5f9f7: Scheduled agents fire their first window on daemon start, even with no prior `triggered_by='schedule'` run.

  Freshly registered scheduled agents used to silently skip their first window: `hasMissedFire(expr, undefined)` returned `false` for any agent that had never fired on schedule before, so the daemon's start-up catch-up logic skipped them. Manual fires (`triggered_by='cli'|'dashboard'`) didn't count toward seeding. Net effect: installing `daily-greeting` at 10 AM and starting the daemon meant nothing fired until 8 AM **the next day** — and only then because that fire seeded the catch-up for future windows.

  Now: when `since` is undefined, catch up if the most recent past cron tick is within the past 24 hours. Daily/hourly/sub-day crons fire on first daemon start as users expect. Weekly/monthly/yearly crons whose most recent tick is older than 24h aren't surprise-fired on daemon restart.

- f53d2bf: ci: gitleaks secret-scan on push + PR

  Adds `.github/workflows/secret-scan.yml` running gitleaks on every
  push + pull request. Catches secret-shaped strings (`xoxb-…`,
  `ghp_…`, `AIza…`, base64 RSA keys, …) before they hit main on a
  public repo. Config in `.gitleaks.toml` extends the upstream default
  ruleset and allowlists test fixtures that intentionally hold
  secret-shaped strings (redactor self-tests, env-builder fixtures,
  ADR examples).

  `scripts/install-hooks.sh` is an opt-in local pre-commit hook that
  runs the same scan against staged changes so leaks die at commit
  time rather than after a force-push. Not auto-installed by
  `npm install` — explicit by design. Documented in docs/SECURITY.md.

- cd78065: Fix Improve-layout inline drafting: commit each drafted agent as its own single-agent BuildPlan instead of batching them into one commit. The commit endpoint schema requires `intent='agent'` to have exactly one `newAgents` entry, so the batched commit failed validation when the user drafted more than one agent at a time. Now: one commit per drafted agent, sequential; partial successes are surfaced and the layout still applies for whatever landed.
- 4dcf360: Fix duplicate-container overlap in the dashboard layout after repeated Improve-layout runs:

  - **Merge instead of duplicate**: `mergePlanWithDraftedAgents` now reuses an existing "Newly drafted" container if one is in the plan (carried over from a prior session by the planner). Previously it always appended a new one, producing two sections with the same label that overlapped visually.
  - **applyPlan dedupes by label**: the wizard's localStorage writeback now collapses any duplicate-label containers (case-insensitive) before saving, so even a plan that slips through with duplicates resolves into one section with the union of tiles.
  - **Server-side commit dedupes too**: `/dashboards/:id/layout-plan/commit` now merges duplicate-title sections before writing `dashboard.layout.sections`. Defensive — keeps the persisted layout clean regardless of what the client sent.

- 794465b: Refine-this-plan UX fix: when the user has typed into the refine textarea (or answered a clarifying question), "Update plan" promotes to primary styling and "Apply layout" demotes to ghost. Matches actual intent — if you're typing feedback, you mean to iterate, not commit. Repeated mis-clicks on Apply during refinement triggered this. The refine block is also now boxed (subtle surface-raised background, border) and sits with more breathing room above the Cancel/Apply action row so the two regions are visually distinct.
- 06c86a1: dashboard: tabs on Settings → Integrations + Gmail setup guide

  The integrations page is now tabbed by kind (All, Slack, Webhook, File,
  Gmail) so the surface stays scannable as more kinds land. The active
  tab is in the URL (`?tab=slack`), so deep links and form-error
  redirects land on the right card.

  The Gmail tab opens with a step-by-step setup guide pointing at
  `console.cloud.google.com` (not `admin.google.com`, which is a
  different surface that doesn't expose OAuth client creation), with
  direct links to each console page: create project, enable Gmail API,
  configure consent screen with the right scope, create the OAuth 2.0
  Client ID with the redirect URI registered. Also explains why sua
  asks the user to bring their own credentials (no embedded client →
  no Google verification gate → trust-clean for an open-source tool).

- acf89a5: The "Draft these agents" CTA now sits in the action row alongside Cancel and Apply layout, so all three choices are visible together: Cancel · Apply layout only · **Draft N agents + apply**. When the planner emits `needsNew[]`, Draft becomes the primary button (since the user explicitly asked for new agents) and Apply layout demotes to a ghost-style "skip drafting" escape hatch.
- 9bc2433: The Improve-layout wizard now auto-retries once on schema-validation failures, and the planner prompt has a strict, example-laden agent-id-format rule up front. Cuts down on user-facing schema errors like `topAgents.id must be lowercase_with_dashes_or_underscores` that the planner can fix itself.
- 2db5fdc: Layout planner no longer emits empty containers on named dashboards.

  The prompt previously told the planner to lead with a "Health" container holding the four system tiles. Pulse has those tiles; named dashboards don't. On a dashboard, the planner would dutifully emit an empty Health container and the whole plan failed schema validation (`containers.0.tiles must have at least one entry`). The rule is now conditional on `CURRENT_LAYOUT` actually containing system tiles, with an explicit "never emit a container with zero tiles" rule up top.

- 9dee250: The Improve-layout wizard's proposed-layout view now has an always-visible "Refine this plan" textarea + Update plan button just above the action row. Lets you redirect the planner ("drop stock-ticker", "go more educational", "no crypto") without backing out to the original FOCUS field. Previously Update plan only appeared when the planner emitted clarifying questions; now it's always there.
- 5961e20: Run "Run again" in place on Pulse / dashboard widget tiles.

  Clicking a widget tile's "Run again" button used to start the run and then
  redirect to the run detail page, dropping you off the dashboard. It now
  re-runs the agent and refreshes the tile in place — the same in-place flow
  interactive widgets already use. Without JS the button still falls back to
  the run detail page, so nothing breaks.

- 9004048: Move the `chmod +x packages/cli/dist/index.js` from the cli package's build script into the root `npm run build` script.

  PR #299 added the chmod to `packages/cli/package.json`'s `build` script, intending to restore the execute bit on every CLI rebuild. But the root `npm run build` uses `tsc --build` (the TypeScript composite-project orchestrator), which compiles every workspace package but doesn't execute per-package npm scripts. So the chmod was bypassed on every full root rebuild — which is the workflow contributors actually use after a clean (per `CLAUDE.md` / `feedback_clean_build_before_push.md`).

  Symptom: `sua --version` started printing `permission denied: sua` again after any `rm -rf packages/*/dist && npm run build` cycle. Now the chmod is in the root build script so it's guaranteed to run after every full build, regardless of which entry point was used.

- ffb85c6: `sanitizeHtml` now preserves `<style>` blocks (with their bodies scrubbed for `javascript:` / `expression()` / `behavior:` / external `@import`) instead of stripping them entirely. ai-template widgets that rely on CSS-grid or flex layout — e.g. hero stat cards, dashboard hero sections — render with their intended layout instead of falling back to vertical block stacking.

  Threat model unchanged in practice: the dashboard's CSP already permits `'unsafe-inline'` styles, and the new `sanitizeStyleBlock` helper applies the same scrubbing the existing inline-`style="…"` sanitizer uses (kills `javascript:`/`expression()`) plus stylesheet-specific defenses (`behavior:`, external `@import`). `<script>` and other dangerous block constructs still get stripped.

- 040f530: Fix pulse tile footer being overlapped by tall interactive widgets.

  When a tile renders an interactive widget whose inputs form is taller than the tile's `max-height: 400px`, the footer (agent link + run age) used to scroll with the content and end up visually overlapped by the form fields — making the agent link unreachable and the timestamp invisible.

  `.pulse-tile__footer` now uses `position: sticky; bottom: 0; background: var(--color-surface)` so it pins to the bottom of the visible tile area regardless of how tall the body is. `margin-top: auto` is preserved so it still sits at the bottom of the flex column when content is short.

- 153306b: Template renderer drops leftover handlebars block tokens instead of leaking them to rendered widgets.

  When an ai-template uses an unsupported handlebars form (helpers like `{{#if (eq …)}}`, `{{else}}` branches, or item-scoped `{{#if item.field}}` inside an `{{#each}}` body), the renderer previously left the raw `{{#if …}}` / `{{/if}}` tokens in the output. A safety net now strips any remaining `{{#X}}…{{/X}}` blocks (and bare `{{else}}` / `{{#X}}` / `{{/X}}` tokens) after all supported substitution passes, so unsupported syntax fails closed rather than dumping handlebars source to the page.

- 80442ba: Fix ai-template renderer truncating tables when `{{#if outputs.X}}` wraps an `{{#each}}` whose body contains item-scoped `{{#if item.X}}…{{/if}}`.

  Outer `{{#if outputs.X}}` was processed first with a non-greedy body match, so it terminated at the FIRST `{{/if}}` — the inner item-scoped closer — truncating the wrapped table after the first cell and dropping every row. Reorder the passes so `{{#each}}` runs before outer `#if`/`#unless`: per-iteration rewriting consumes item-scoped `{{/if}}` tokens first, leaving the outer block with a balanced body. The wrapping pattern is the natural LLM-authored form (`{{#if outputs.X}}…table…{{/if}}{{#unless outputs.X}}…empty…{{/unless}}`) and now renders correctly. Regression caught by the greenhouse-search-discovered widget showing zero table rows.

- a81a3d0: Two follow-ups to the tile-removal confirm modal:

  - **Stay in edit mode after removing a tile.** The `pagehide` handler cleared edit mode on every navigation, including the delete redirect — so removing a tile bounced you out of edit mode. It now skips the clear when the navigation is a deliberate in-app action (confirmed delete / form submit), so you stay in edit mode and can keep arranging.
  - **Pulse tiles get the same confirm modal.** The Pulse "hide from Pulse" × now shows the in-app modal too (previously it submitted with no confirmation). Confirm button label + title are per-form ("Hide" / "Hide tile?" on Pulse, "Remove" / "Remove tile?" on dashboards).

  Also fixes a double-escaping bug in the confirm message — the tile title was manually `&quot;`-escaped and then re-escaped by the `html` tag, surfacing literal `&quot;` in the dialog. The manual escape is removed; the tag handles it.

- 9664423: Tool-usage visibility on `/tools/:id` and the agent overview.

  The `/tools/:id` detail page now has a "Used by" section listing every agent in the catalog that statically references this tool — sourced from the parse-time `agent.capabilities.tools_used` (covers explicit `tool:`, type-based desugaring, and node-level `allowedTools`). Empty state renders an explicit "no agents reference this tool yet" line.

  Agent overview's tool badges now use the same canonical source, so badges include `allowedTools` entries that the previous inline derivation missed. Claude-code-native tools (`Bash`, `Edit`, `NotebookEdit`) render as plain badges instead of dead links to `/tools`.

  This is the first slice of the tool-policies feature (PR A: visibility surface). The policy file shape, enforcement engine, and CLI/dashboard rule editor land in PRs B–D.

- 5a98732: Tool-policies PR B: file shape, loader, executor seam (always-allow stub).

  Defines the on-disk schema for `.sua/policies.json` (`version: 1`, `defaultAction`, `rules[]`) plus `loadPolicyDocument(dataDir)` which reads the file when present and returns the default allow-all document otherwise. Malformed JSON or schema-invalid files throw `PolicyLoadError` rather than falling back silently — operators want a loud failure on configuration bugs.

  The dag-executor now runs every tool dispatch through `evaluatePolicy()` before calling `tool.execute()`. **No behaviour change today**: the function is a stub that always returns `{effect: 'allow'}`. PR C drops in real glob matching + condition evaluation here without touching downstream dispatch.

  New `'policy_denied'` value on `NodeErrorCategory` and a corresponding `PolicyDeniedError` class. The executor's tool-dispatch catch is special-cased so a thrown `PolicyDeniedError` lands in `node_executions.errorCategory` as `policy_denied` instead of the generic `setup`. Policy denials are intentionally NOT in the default retryable-categories list — denying is a stable signal.

  `extractPrimaryResource(node, toolId)` extracts the URL/path/command the tool would touch, ready for PR C's matcher to glob against. Templated values are returned as-is (the seam runs before substitution, by design — authors can write deny rules against literal template strings).

- 09eadbd: Output Widget editor's Save no longer wipes `columns:` on table fields, `controls:`, or `actions:` — schema shapes the form doesn't yet surface are now carried forward from the previous version.

  The dashboard's Output Widget editor only has form fields for `name` / `label` / `type` per field plus the interactive-mode flags. Save used to rebuild `outputWidget` from scratch using only those inputs, silently dropping anything else — so any author who set up `controls:` / `actions:` via the YAML editor, or used the new `type: table` field (which requires `columns:`), would lose them on the next Save click. Preservation rules:

  - Per-field `columns:` carry forward when the field name AND type are both unchanged from the previous version. Switching a field's type away from `table` strips its `columns` (the new type can't use them).
  - Top-level `controls:` and `actions:` carry forward when the widget type is unchanged. A type switch implies "start over" — controls target arrays the new widget may not surface.

  Also adds `table` to the editor's `VALID_FIELD_TYPES` set (was missed in #286), so the type dropdown's `table` option actually saves through instead of being silently coerced to `text`.

- bc0ebfd: Output-widget editor now rejects a save that would silently wipe `outputWidget.fields` for typed widgets (`dashboard`, `key-value`, `diff-apply`, `raw`).

  Regression path: switching widget type from `ai-template` back to a typed widget via the editor cards shows an empty field table (the JS doesn't restore the prior rows). Clicking Save used to store `{ type: 'dashboard', fields: [] }`, which renders three blank divs AND silently dropped the previously-saved fields.

  POST `/agents/:id/output-widget/update` now returns a 303 redirect with a flash error like _"Add at least one field for 'dashboard', or click Remove output widget to delete it entirely. The previous version had 3 fields — they were dropped because the form posted no rows."_ — and leaves the stored widget untouched. The user either adds a row or uses the explicit Remove button.

- 215cb13: Dashboard widget extractor now recovers a trailing JSON object embedded inside human prose. claude-code summarisers commonly emit a human-readable narrative followed by a final `{…}` line that drives the widget — the prior extractor only handled pure-JSON output or XML tags, so the widget rendered empty for any agent that produced both kinds of output.

  `extractField()` is now exported from `views/output-widgets.ts` and unit-tested. The recovery strategy walks `{` positions from rightmost to leftmost and slices to the last `}`, preferring the smallest trailing object so we don't accidentally engulf earlier prose that contains brace characters.

- 7037a35: Planner prompts: teach the LLM to use `signal.template: widget` when the agent has an `outputWidget`.

  Pulse tile rendering is dispatched by `signal.template`, NOT by `outputWidget.type`. An agent with `outputWidget: { type: ai-template, template: <rich HTML> }` and `signal.template: text-headline` will silently render the bare headline on Pulse — the ai-template work is wasted.

  Both planner prompts (`agents/examples/agent-builder.yaml` and `agents/examples/build-planner.yaml`) previously omitted `widget` from the allowed `signal.template` list, so wizard-built rich-output agents could never reach Pulse with their template. Both now:

  - Include `widget` in the allowed list
  - Explicitly recommend `signal.template: widget` whenever the agent declares an `outputWidget`
  - Note that `signal.mapping` should be omitted in that case (the widget drives layout)

  The schema, autoFix, and Pulse Configure dialog have always accepted `widget` correctly — this PR closes the prompt gap that was preventing wizard-built agents from emitting it.

- 07d24c1: dashboard: fix wizard JS bundle parse error from #254

  The runPlanner refactor in #254 left the trailing `});` from the
  addEventListener it replaced — that produced an unbalanced `)` in the
  inlined script and broke parse for the entire build-from-goal bundle
  (`Uncaught SyntaxError: Unexpected token ')'`). Wizard didn't open at
  all on any page. Closes runPlanner with `}` and the IIFE with `})()`.

- Updated dependencies [c788a70]
- Updated dependencies [c1f605a]
- Updated dependencies [eb7eff3]
- Updated dependencies [a53adad]
- Updated dependencies [f55afe7]
- Updated dependencies [6459542]
- Updated dependencies [d72d4e6]
- Updated dependencies [1da69c4]
- Updated dependencies [f336d0f]
- Updated dependencies [6fa5149]
- Updated dependencies [3564c8c]
- Updated dependencies [84ecaa8]
- Updated dependencies [417bae9]
- Updated dependencies [4b3087c]
- Updated dependencies [63db5d1]
- Updated dependencies [1a993ed]
- Updated dependencies [1d128d9]
- Updated dependencies [2cc72d3]
- Updated dependencies [f1c4228]
- Updated dependencies [c560c69]
- Updated dependencies [e0cc472]
- Updated dependencies [16b0422]
- Updated dependencies [86acb69]
- Updated dependencies [260589e]
- Updated dependencies [bc0a0fd]
- Updated dependencies [15a39d6]
- Updated dependencies [ad94b09]
- Updated dependencies [5f88fbd]
- Updated dependencies [7686abb]
- Updated dependencies [8892cfa]
- Updated dependencies [28e7274]
- Updated dependencies [62ffca4]
- Updated dependencies [7d21677]
- Updated dependencies [ca7be93]
- Updated dependencies [5e974c0]
- Updated dependencies [7043bd7]
- Updated dependencies [123f65c]
- Updated dependencies [6f76270]
- Updated dependencies [d6f9872]
- Updated dependencies [be43277]
- Updated dependencies [bd5f9f7]
- Updated dependencies [f53d2bf]
- Updated dependencies [cd78065]
- Updated dependencies [4dcf360]
- Updated dependencies [60aa32f]
- Updated dependencies [d7af1b0]
- Updated dependencies [5aa3853]
- Updated dependencies [c7221dd]
- Updated dependencies [794465b]
- Updated dependencies [ab118ec]
- Updated dependencies [94e607b]
- Updated dependencies [c05f260]
- Updated dependencies [021f499]
- Updated dependencies [1295333]
- Updated dependencies [16e9a9a]
- Updated dependencies [06c86a1]
- Updated dependencies [75763e6]
- Updated dependencies [f60a468]
- Updated dependencies [9d99976]
- Updated dependencies [ed71f4c]
- Updated dependencies [8a09dab]
- Updated dependencies [621939d]
- Updated dependencies [3a0f43d]
- Updated dependencies [acf89a5]
- Updated dependencies [9bc2433]
- Updated dependencies [07f661d]
- Updated dependencies [2db5fdc]
- Updated dependencies [abed134]
- Updated dependencies [9dee250]
- Updated dependencies [0a88b2e]
- Updated dependencies [ec676a1]
- Updated dependencies [5d10f71]
- Updated dependencies [af5edb9]
- Updated dependencies [81dd182]
- Updated dependencies [262ffa9]
- Updated dependencies [7f41ba0]
- Updated dependencies [ee8cd9c]
- Updated dependencies [68174cc]
- Updated dependencies [2c82a16]
- Updated dependencies [d83b9ce]
- Updated dependencies [a1f854f]
- Updated dependencies [bd29502]
- Updated dependencies [5787f35]
- Updated dependencies [5961e20]
- Updated dependencies [9004048]
- Updated dependencies [ffb85c6]
- Updated dependencies [05b87a6]
- Updated dependencies [040f530]
- Updated dependencies [d2e3771]
- Updated dependencies [97a8c7a]
- Updated dependencies [8259154]
- Updated dependencies [153306b]
- Updated dependencies [80442ba]
- Updated dependencies [a81a3d0]
- Updated dependencies [9664423]
- Updated dependencies [5a98732]
- Updated dependencies [99c9f5a]
- Updated dependencies [43f84c8]
- Updated dependencies [e1d0cf9]
- Updated dependencies [09eadbd]
- Updated dependencies [bc0ebfd]
- Updated dependencies [215cb13]
- Updated dependencies [7037a35]
- Updated dependencies [670a46e]
- Updated dependencies [07d24c1]
- Updated dependencies [dd4b78a]
  - @some-useful-agents/core@0.21.0

## 0.20.0

### Minor Changes

- 5c2e83f: agent-builder uses the manifest layer.

  Wires the manifest data shipped in PR A.5/A.6/A.7 into the existing `design → validate → fix` agent-builder DAG. Three changes:

  **Discovery catalog upgrade** — `buildDiscoveryCatalog` now sources node-types from the canonical `NODE_CATALOG` (PR A.7) instead of a hand-authored string, and includes per-agent `outputs:` (PR A.5) + `capabilities:` (PR A.6) in the AVAILABLE AGENTS section. New CRITICAL — OUTPUT WIDGET FIELD SCHEMA section calls out the most common bug (`name:` is the JSON key, not a label; do NOT use `source:`/`path:`/`from:`/`key:`). New DESIGN DISCIPLINE section enforces decomposition (3+ stages → 3+ nodes), `outputs:` declaration, and template-syntax rules.

  **Agent-builder prompt** — `agents/examples/agent-builder.yaml` adds explicit decomposition discipline, outputs declaration rules, widget field schema rules with concrete examples, and signal-template/title rules.

  **`autoFixYaml` extensions** — five new fixes for residual LLM mistakes the prompt doesn't always prevent:

  - Widget field `source:` / `path:` / `from:` / `key:` → `name:` (with smart name/label swap when name was treated as a label)
  - Invalid `signal.template` → fallback to `text-headline`
  - `signal.title` JSEP-style expression → strip to first quoted segment
  - `signal.mapping.*` non-string value (array/object) → `result`
  - `outputWidget.title` (invented field) → silently strip

  **Dogfood result**: rebuilt the same weather-agent prompt that produced 6 distinct bugs in the baseline. Improved version produces clean YAML with `outputs:` declared, multi-node decomposition, correct widget field names, plain-string signal title, and a smarter API choice (Open-Meteo + geocoding instead of wttr.in). 12 new tests for the autoFixYaml extensions.

- 0042d16: Derived agent capabilities at the parse boundary.

  New `deriveCapabilities(agent: Agent): AgentCapabilities` in core. Computes a static, best-effort summary of what an agent uses and does — populated by `parseAgent` and `agent-store.rowToAgent` and exposed on `Agent.capabilities`.

  ```ts
  {
    tools_used:        string[],   // shell-exec, claude-code, http-get, allowedTools entries…
    mcp_servers_used:  string[],   // extracted from mcp__server__tool naming
    side_effects:      ('sends_notifications' | 'writes_files' | 'posts_http')[],
    reads_external:    string[],   // URLs from toolInputs.url/endpoint, regex hits in command/prompt
  }
  ```

  Heuristic and conservative — an empty array means "couldn't statically prove," not "doesn't do X." Not a security boundary. Used by the planner-fronted agent-builder (PR A) for cross-agent composition decisions and by the upcoming preflight checks ("does this agent need MCP servers I haven't installed?"). Recomputed on every read; never persisted.

- 0a73abe: Author-declared agent outputs.

  New top-level `outputs:` field on agents — a typed map describing the shape the agent's final-node JSON result reliably contains. Mirrors `inputs:` but with `lowercase_snake_case` names (matches JSON convention) and types `string | number | boolean | object | array`. Optional but recommended.

  ```yaml
  outputs:
    articles:
      type: array
      description: List of stories with title, url, score
    count:
      type: number
  ```

  Documentation, not a runtime contract — the executor doesn't verify the JSON matches. Used by the planner-fronted agent-builder (PR A) for cross-agent composition via `agent-invoke`, and by the Output Widget editor for `name:` field suggestions. Three example agents (`llm-tells-a-joke`, `daily-joke`, `two-step-digest`) now declare `outputs:` as reference patterns.

- 4ca3edf: New `sua agent reimport <path>` verb + sweep of example agents to enable pulse-tile interactivity.

  Editing `agents/examples/*.yaml` previously required a one-off node script to land — once an agent is in the run DB, the on-disk YAML is no longer authoritative. The new verb takes a YAML file or a directory, calls `agentStore.upsertAgent` for each, and prints a per-file `created` / `updated` (with version bump) / `unchanged` (DAG identical, metadata refreshed) / `failed` summary. Idempotent.

  Sweeps eight example agents that declare runtime `inputs:` (api-monitor, ashby-discover, ashby-jobs-multi, ashby-search-discovered, cat-video-finder, vimeo-staff-picks, weather-dashboard, weather-forecast) and adds `outputWidget.interactive: true` so their pulse tiles render with the inline inputs form + run button. Run `sua agent reimport agents/examples` after pulling to land them in your local DB.

- 0745598: ai-template iteration + per-agent visibility toggles.

  The ai-template widget now supports `{{#each outputs.X as item}}…{{/each}}` block iteration (with nested `{{item.field}}`, escaped `{{item.field}}` vs unescaped `{{{item.field}}}`, and `{{@index}}`) plus a `{{{outputs.X}}}` triple-brace unescaped variant. List-shaped agent outputs (HN feeds, GitHub PR digests, monitoring dashboards) can now render proper card layouts instead of HTML-escaped JSON blobs.

  Adds two new top-level agent fields — `pulseVisible` and `dashboardVisible` (both default true). Toggleable from a new Visibility card on the agent Config tab. `pulseVisible: false` hides a tile from /pulse even when a signal is declared (legacy `signal.hidden` still honored). `dashboardVisible: false` hides the agent from the /agents list view; it remains reachable via direct URL, MCP, scheduler, and the runs page.

- 9b482b6: ARG_MAX defense-in-depth — three follow-ups to the claude-stdin fix (#220).

  1. **Fat upstream tempfile fallback** for shell nodes. When an `UPSTREAM_<ID>_RESULT` env value exceeds 32KB, it gets truncated inline (with a `...(truncated; full value at $UPSTREAM_<ID>_RESULT_FILE)` marker) and the full payload is written to `$STATE_DIR/_upstream/<runId>/<nodeId>.txt`. A new `UPSTREAM_<ID>_RESULT_FILE` env var holds the path. Shell agents that need the full payload do `cat $UPSTREAM_<ID>_RESULT_FILE`. Small upstreams behave exactly as today.

  2. **Argv+env soft-cap guardrail** at `spawnProcess`. Refuses spawn with a structured `setup`-category error when the rendered argv+env exceeds 200KB (well below kernel ARG_MAX ~256KB so we leave headroom for under-sandbox stricter limits). Error message names the heaviest env var and suggests `$<NAME>_FILE` as a fix. Catches any future regression that re-introduces fat-arg/env paths instead of surfacing as raw `spawn E2BIG`.

  3. **Codex spawner now pipes prompt via stdin** (mirrors #220's claude fix). The `codex exec` invocation reads its prompt from stdin natively. Was untouched in #220 because the CLI's stdin behaviour wasn't verified; codex-using agents now share the same E2BIG immunity as claude-code.

  Verified live on `ashby-search-discovered`: fat upstream payloads (1.6MB JSON, 180KB HTML) are now correctly written to `_upstream/<runId>/<nodeId>.txt` instead of being stuffed into env vars.

- b2f5498: Auto-retry on transient failures (R2 of failed-runs-and-retry plan).

  Agents can declare a top-level `retry:` block. When a run fails with a configured `errorCategory`, the orchestrator sleeps with backoff and spawns a fresh attempt, linked back to the head of the chain via `retryOfRunId` (same shape as R1's manual retry).

  ```yaml
  retry:
    attempts: 3 # total tries including the first; default 1
    backoff: exponential # exponential (default) | linear | fixed
    delaySeconds: 30 # base; 30 → 60 → 120 for exponential
    categories: [timeout, spawn_failure] # default; conservative
  ```

  `cancelled`, `setup`, `input_resolution`, `condition_not_met`, `flow_ended` are NEVER retried regardless of policy — they're deterministic or user-driven.

  Implementation lives ABOVE the executor as a thin wrapper (`executeAgentWithRetry` in core/retry.ts). Callers — Run Now, manual retry, widget run, `sua workflow run` — switched from `executeAgentDag` to the wrapper. Replay route stays on the raw executor (replay is investigation, not auto-recovery). Agents without a `retry:` block fall through to a single executor call (zero overhead).

- c2b6ad5: Build from goal v2 — agents, dashboards, or both, with a survey-and-plan
  review screen.

  The wizard previously only built single agents. It now auto-classifies
  intent across four flavors: `agent`, `dashboard-existing`,
  `dashboard-new`, `dashboard-mixed`. The user's goal hits the new
  `build-planner` agent, which surveys what's already installed
  (matched agents, missing fragments, overlapping dashboards) and emits
  a structured `BuildPlan` JSON with:

  - the proposed dashboard (when applicable)
  - new agents to create (each with full YAML — editable in the review)
  - clarifying questions for ambiguous parts of the goal

  The review screen surfaces all four blocks; the user edits YAMLs
  inline, then commits via `POST /agents/build/commit` which walks the
  plan creating agents + the dashboard atomically (with partial-success
  reporting). Redirect lands on the new dashboard for dashboard intents,
  or the new agent's page for agent intents.

  **New plumbing:**

  - `packages/core/src/build-plan-schema.ts` — Zod schema for `BuildPlan`
    with cross-field validation (intent="agent" can't have a dashboard;
    dashboard agentIds must reference matched or new agents; etc.) plus
    `extractPlanJson()` for unwrapping `<plan>…</plan>` / fenced JSON.
  - `packages/core/src/discovery-catalog.ts` — accepts optional
    `dashboards` + `packs` args and renders them as new catalog sections
    so the planner LLM can see installed-state.
  - `agents/examples/build-planner.yaml` — the multi-flavor planner.
    Single claude-code node, structured output to `<plan>…</plan>`.
  - `POST /agents/build/commit` (new) + `GET /agents/build/:runId`
    (extended to return `BuildPlan` instead of raw YAML) +
    `POST /agents/build` (now invokes the planner instead of agent-builder).
  - `POST /agents/build/create` kept as a thin compat shim.
  - Wizard JS + modal copy updated to surface the plan-review stage and
    hint at the dashboard flavors.

  19 new unit + supertest cases; full suite 1066/1066 green. Live smoke
  on three goals (agent / dashboard-existing / dashboard-mixed)
  produces sensible plans.

- cd21018: Build planner: critic loop with auto-retry + tighter commit telemetry.

  The build wizard now structurally validates each plan before showing it to you. New `critiquePlan()` walks every newAgent YAML through `parseAgent`, checks dashboard refs against your actual catalog, and verifies that `loopConfig.agentId` / `agentInvokeConfig.agentId` cross-references inside generated agents resolve to either an installed agent or another newAgent in the same plan.

  When the critic flags issues, the planner is re-fired up to two more times with a structured "Critic feedback:" block appended to the goal — so it sees exactly which fields to fix. After all retries exhaust, the wizard surfaces the remaining issues with a "Commit anyway" override so you stay in control.

  Telemetry: `recordCommit` now only fires when an agent or dashboard actually landed, so `/metrics/planner` no longer counts dismissed/failed commits toward commit-rate. Retry attempts are routed back to the original telemetry row via the new alias map, so per-pipeline metrics stay accurate.

- 60a4f40: Build-from-goal v3 — bias the planner toward multi-agent / multi-node
  composition over rebuilding monoliths.

  When a goal looks like _primitive × list-of-inputs_ AND the catalog
  already has a matching primitive, the planner now proposes ONE
  orchestrator that wraps the existing primitive via `loop` +
  `agent-invoke`, instead of drafting parallel near-duplicate agents.

  Live verification: prompt _"Find me senior product manager roles
  across rula, ramp, notion, and linear, and refresh weekly"_ now
  produces a single `pm-role-tracker` orchestrator that does
  `agent-invoke ashby-jobs-multi` (the existing primitive) on a
  weekly schedule — not a fresh rewrite.

  Changes:

  - **`agents/examples/build-planner.yaml`** — adds a STEP 3b
    ("COMPOSE OVER EXISTING AGENTS") with the `loop + agent-invoke`
    recipe and an explicit anti-pattern callout for "two near-identical
    primitives." Uses angle-bracket placeholders (`«inputs.X»`) in the
    recipe pseudocode so the agent-yaml validator doesn't try to resolve
    the example template references against the planner's own scope.
  - **`packages/core/src/discovery-catalog.ts`** — AVAILABLE AGENTS
    section header now ends with: "ANY AGENT HERE IS LOOP-INVOKABLE…"
    - the per-iteration `$item.<field>` mapping syntax.
  - **NEW** `agents/examples/ashby-jobs-multi.yaml` — multi-company
    Ashby orchestrator (3 nodes: discover → fetch → explain).
    Inlined per-company logic; suitable as a worked example of the
    monolithic alternative the planner can now compose AROUND.
  - **EDIT** `agents/examples/ashby-job-finder.yaml` — strip the
    `{{inputs.X}}` from `signal.title` (the renderer doesn't substitute
    input values into signal titles, so the literal string was showing
    on tiles). Comment in the file documents WHY for the next reader.

  Catalog size budget bumped 11000 → 12500 chars to absorb the new
  composition guidance (~500 chars).

- 2f0aa90: Composition correctness — `agent-invoke` and `loop` now share one input-mapping resolver, and loop items expose parsed structured outputs.

  Two correctness fixes that block clean composed agents (the "wizard → orchestrator → result widget" pattern the build-planner v3 catalog promotes):

  1. `agent-invoke` `inputMapping` now substitutes `{{inputs.X}}` (forwarding the parent agent's inputs to the sub-run) and accepts `$upstream.<id>.<field>` and `$item.<path>` for symmetry with `loop`. Previously only `upstream.<id>.<field>` worked, so a literal `{{inputs.TOPIC}}` would be passed verbatim to the sub-agent.

  2. `loop` results expose `items[]` as **parsed structured outputs** when the sub-agent's result was a JSON object — so a downstream summariser prompt can dot-walk via `{{upstream.<loop>.items.0.<field>}}` instead of having to parse JSON-encoded strings out of an array of strings. Plain-text sub-agent results still come through as raw strings; failed sub-runs are still `null`.

  Both change paths share one resolver (`resolveSourceExpr`), so future composition node types stay consistent.

- 5e5f5e9: "Save as pack" — export a dashboard as a portable pack manifest YAML.

  Adds a download path so users can take a dashboard they've curated and
  turn it into a shareable pack file. Bundles the dashboard's layout
  plus the full YAML of every agent it references into one manifest.

  - **`dashboardToPackManifest()`** in core. Round-trips through
    `packManifestSchema` — the file the browser downloads is parseable
    by the existing pack loader and installable via `installPack`.
  - **`GET /dashboards/:id/export`** returns a YAML attachment with
    `Content-Disposition: attachment; filename="<pack-id>.pack.yaml"`.
    Missing agents (referenced in sections but not in the agent store)
    are dropped from the export and surfaced via an
    `X-Pack-Missing-Agents` response header.
  - **"Save as pack"** button on every dashboard view page, alongside
    Edit layout / Edit sections.

  For now there's no user-pack directory — the downloaded file is
  ready to share or commit, but installing it locally still means
  dropping it in `packages/core/packs/` (a follow-up will add a
  user-pack directory under `~/.sua/packs/` so the loader picks them
  up automatically).

  6 new unit tests cover round-trip-through-schema, missing-agent
  handling, namespace stripping, and id/name/version overrides.

- cc44352: Dashboard editor — create, customise, reorder (widget-packs PR 5/5).

  Closes the widget-packs architecture series. New surfaces:

  - **`GET /dashboards/:id/edit`** — editor for any stored dashboard.
    Each section gets a rename input + up/down arrows + delete; each
    tile gets up/down arrows + delete; an "Add tile" dropdown lists
    agents not already in the section; an "Add a section" form at the
    bottom; "Delete dashboard" for user-created dashboards.
  - **`POST /dashboards`** — create a user dashboard from the dropdown.
    The dashboards dropdown gained a "New dashboard name" input that
    POSTs here; redirects to the new dashboard's editor.
  - **Action endpoints** — `POST /dashboards/:id/sections`,
    `/sections/:idx/{rename,delete,move}`,
    `/sections/:idx/tiles`,
    `/sections/:idx/tiles/:tileIdx/{delete,move}`,
    `/dashboards/:id/delete`. All form-POST + 303-redirect — no JS.
  - **"Edit" button** on every dashboard view page (top-right of the
    header strip).
  - **Pack-owned dashboards are editable** but can't be deleted directly
    (uninstall the pack instead). User-created dashboards can be deleted.
  - The Default Dashboard backing `/pulse` stays non-editable — it's
    auto-derived from `pulseVisible`, so per-agent toggles are the
    edit affordance there (already exists via the existing × button).

  Drag-drop reorder is intentionally deferred. The existing
  `widget-layout.js.ts` has the bones for it (currently localStorage-only);
  swapping its persistence layer to call this PR's `/sections/:idx/move`
  endpoints is a clean follow-up.

  11 new supertest cases covering every action endpoint; full suite
  1038/1038 green. Live smoke: created "Morning Briefing" → added
  Weather section → added weather-forecast tile via the editor.

- be4551f: Render pack dashboards + add a switcher dropdown (widget-packs PR 4/5).

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

- 38f2da6: `file-write` first-class node type.

  A real schema gap surfaced by the dogfood: agent-builder kept reaching for `type: file-write` (a node type that didn't exist) instead of the longer `type: shell` + `tool: file-write` + `toolInputs: { path, content }` form. Promoting it to a first-class node type makes the LLM's intuition correct and keeps YAML readable.

  ```yaml
  - id: save
    type: file-write
    dependsOn: [build-summary]
    path: "output/digest-{{inputs.DATE}}.md"
    content: "{{upstream.build-summary.result}}"
    append: false # optional; default false
  ```

  Top-level `path:` and `content:` desugar to `tool: 'file-write'` + `toolInputs: { path, content, append }` at dispatch time — no executor branch added, just a small `resolveToolId`/`resolveToolInputs` extension. The existing `file-write` tool gained an `append:` mode (writes with `flag: 'a'`).

  Templating: built-in tool dispatch now resolves `{{upstream.X.field}}`, `{{vars.X}}`, and `{{inputs.X}}` in string-typed tool inputs, so `path:` and `content:` (and any other built-in tool's string fields) can reference upstream outputs and inputs. Previously only MCP tools had this.

  Schema enforces `path` + `content` are required when `type: file-write`, and validates that any `{{upstream.X.result}}` reference in `path` or `content` declares `X` in `dependsOn` (same rule as for shell/claude-code).

  Capabilities derivation (PR A.6) updated to recognize `type: file-write` as the `file-write` tool, so `tools_used` and `side_effects: ['writes_files']` populate correctly.

  Node catalog (PR A.7) gets a new entry with description, inputs, outputs, use-when guidance, and example. The forcing-function test ensures the new `NodeType` enum value has a catalog entry.

- 6065e6c: Built-in `http-get` and `http-post` tools now accept an optional `headers` input. Many APIs (icanhazdadjoke, GitHub, anything content-negotiating) return HTML or text by default unless an explicit `Accept` header is sent — the tools used to ignore custom headers entirely, leaving agents to scrape HTML or fall back to a shell `curl` node. The new input is a `{name: value}` object passed through to `fetch`; for `http-post` the caller's headers are merged on top of the default `Content-Type: application/json` (and can override it).

  Also fixes the `daily-joke` example agent: it was rendering the icanhazdadjoke HTML page on pulse because the default content type isn't JSON. Now sends `Accept: application/json` and `User-Agent: some-useful-agents` and gets the documented `{joke}` shape, which the format node parses cleanly.

- 475f28d: Interactive widgets: form is always visible alongside the result.

  Magic-8-ball-style Pulse tiles now render the inputs form below the last result in idle, so re-running with a tweaked prompt is one edit + one click instead of two clicks through a separate "Ask again" pane. Form fields pre-fill with the most recent run's input values rather than the agent's declared defaults. The state machine collapses to idle / running / stuck / error.

- 098bf28: `loopConfig.inputMapping` — pass per-iteration values to looped sub-agents.

  The build-planner v3 catalog teaches the `loop + agent-invoke` recipe with
  `inputMapping: { COMPANY_SLUG: "$item.slug", JOB_QUERY: "{{inputs.JOB_QUERY}}" }`,
  but the loop executor previously only set `ITEM` / `ITEM_INDEX` on each sub-run —
  so sub-agents fell through to their default inputs every iteration and the
  composition pattern never actually worked.

  This adds the schema field and resolves three source forms inside the loop:

  - `$item.<path>` — walk into the current iteration's item
  - `$upstream.<id>.<field>` — pull from any upstream node's structured output
  - `{{inputs.X}}` — forward the parent agent's input X down to each sub-run

  Anything else is treated as a literal. When `inputMapping` is unset, behaviour
  is unchanged (sub-agent still gets `{ITEM, ITEM_INDEX}`).

- 6e96119: Loop nodes now emit per-iteration progress events.

  When a parent agent uses `loop` to fan out across N items, the dashboard previously rendered the loop as a single black box that read "running" for the entire fan-out — users had to dig into nested sub-run pages by URL to see whether iteration 3 of 8 was alive, dead, or just slow.

  Loop nodes now create a `running` node-execution row up front and emit two `SpawnProgress` events per iteration (`loop_iteration_start` / `loop_iteration_complete`) into the existing `progressJson` channel. The dashboard's run-detail progress indicator already reads that channel, so messages like `iteration 3/4: rula done` and `iteration 1/4: ashby failed — <error>` show up inline at the parent run without further dashboard work.

  Failed iterations also surface their sub-run error in the message, so partial-failure debugging no longer requires URL-walking into nested runs.

- 96b1089: One-click manual retry on failed runs.

  Failed runs (`status: failed`) gain a Retry button on the run-detail page. Clicking it recovers the original agent-level inputs from the prior run, creates a fresh run with `attempt: N+1`, and links back to the head of the chain via the new `retryOfRunId` field. Distinct from Replay (which re-runs from a specific node reusing upstream outputs); Retry redoes the whole run from scratch — the right tool for transient failures. Run-detail header now shows an "attempt N" badge on any retry, plus a "Retry of" link back to the original.

  Schema additions: `runs.attempt INTEGER DEFAULT 1`, `runs.retry_of_run_id TEXT` (nullable). Migrations are additive — existing runs default to `attempt=1, retry_of_run_id=NULL`.

  Foundation for upcoming auto-retry (agent-declared `retry:` policy), notify deferral, and triage surfaces.

- bea09e7: Dashboard: control the outbound MCP server from `/settings/mcp`.

  A new Settings tab between Variables and MCP Servers shows the live state of the MCP server (the one Claude Desktop talks to): running/stopped status with PID, endpoint URL, bearer-token fingerprint with a link to rotate, list of `mcp: true` agents with run counts, and a pre-filled Claude Desktop config snippet you can copy directly into `claude_desktop_config.json`. Start and Stop buttons spawn or signal the MCP service via the same daemon supervisor `sua daemon start` uses, so the dashboard and the CLI agree on the PID file at `<dataDir>/daemon/mcp.pid`. The supervisor moved from the `cli` package to `core` so the dashboard can use it directly.

- 0f93483: mcp-server: `run-agent` accepts inputs.

  The MCP `run-agent` tool now takes an optional `inputs` map so MCP clients (Claude Desktop, Claude Code, Cursor) can run agents that declare an `inputs:` block, not only the input-less ones. Values are validated through the same path as dashboard / CLI / scheduler runs (type checks, enum membership, undeclared-key rejection, missing-required errors). Validation failures surface as MCP `isError: true` with the user-readable message instead of a generic 500.

  Two defensive caps live at the MCP boundary specifically: 8 KB per value, 64 KB total. Dashboard / CLI / scheduler are unaffected. The `list-agents` tool now also returns each agent's declared input schema (type, required, default, enum values) so callers can introspect what to pass.

  Known follow-up: shell agents that interpolate raw inputs into command strings via `{{inputs.X}}` (or unquoted env-var expansion) are vulnerable to injection regardless of trigger source. Tracked separately for a hardening pass at the substitution layer.

- 9bcce23: Node catalog API + dashboard page.

  Hand-authored typed contract for every first-class node type (`shell`, `claude-code`, `conditional`, `switch`, `loop`, `agent-invoke`, `branch`, `end`, `break`). Each contract has a description, full inputs and outputs lists, "use when" guidance, and a copy-pasteable example.

  - `NODE_CATALOG` + `listNodeContracts()` + `getNodeContract()` exported from `@some-useful-agents/core`.
  - Dashboard routes: `GET /api/nodes` (full catalog as JSON), `GET /api/nodes/:type` (single entry), `GET /nodes` (browseable HTML page).
  - New "Nodes" entry in the top nav between Tools and Runs.

  The planner-fronted agent-builder (PR A) will query `/api/nodes` during its discover step so the LLM works from the actual node-type contract instead of guessing or inventing names like `file-write` or `template`. The page is also useful for humans browsing what's available.

  Forcing function: a test asserts every `NodeType` has a catalog entry — adding a new node type without documenting it fails the test.

- 29b524f: Notify deferral: one page per retry chain, not one per attempt (R3).

  When an agent has a `retry:` policy, `notify:` handlers now fire **once per chain** at the terminal outcome instead of once per attempt. A 3-attempt agent that recovers on attempt 2 produces one `success` notify and zero `failure` notifies. A run that exhausts its budget over three failed attempts produces one `failure` notify, not three.

  Mechanism: `executeAgentDag` accepts a new `suppressNotify` option that the orchestrator sets on every internal attempt. The wrapper fires notify itself after the chain settles. Agents without a `retry:` policy fall through to single-attempt mode and fire notify exactly as before — no behavior change.

  Builds on R1 (manual retry) + R2 (auto-retry policy). R4 (triage surface) and R5 (scheduler backoff) still to come.

- 3508c50: Onboarding + discovery for widget packs and Build-from-goal.

  - **Home page** (`/`) gains a "Build from goal" CTA + "Browse packs"
    link in the header. The wizard modal markup is now a shared partial
    (`build-from-goal-modal.ts`) used by both the home page and
    `/agents`. New users start their session with the wizard one click
    away instead of having to navigate into Agents first.
  - **Dashboard tutorial** gains an 8th step ("Install a widget pack")
    that points users at `/packs`, marks itself done when any pack has
    `installed_at` set, and explains the dashboards switcher dropdown.
  - **CLI tutorial outro** now closes with a "Want a richer experience?"
    block: `sua dashboard start` plus the three surfaces worth visiting
    first (Packs, Pulse, Build from goal).
  - **README** "What you get" gains Widget packs + Dashboards bullets;
    the Output widgets bullet now mentions the `{{#if}}` / `{{#unless}}`
    / `{{#each}}` grammar and inline widget controls; the Dashboard
    section documents `/packs`, `/dashboards/:id`, the editor, and the
    Pulse "Hide all" / "Show all" bulk-toggle.

- 647e172: Rescue analyzer/builder LLM mistakes in `outputs:` and ai-template widgets,
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

- be4551f: Pack manifest format + first built-in Starter pack (widget-packs PR 2/5).

  Builds on PR 1's stores. New modules in `packages/core`:

  - **`pack-schema.ts`** — Zod schema for the pack manifest YAML format.
    Validates pack id, semver version, dashboard structure, and the
    `yaml` / `yamlPath` mutual exclusion on agent refs.
  - **`pack-loader.ts`** — discovers `packages/core/packs/*.yaml` on
    daemon start, validates each, resolves `yamlPath` agent refs against
    the manifest's directory, and upserts into `PacksStore` as
    `source = 'builtin'`. Idempotent: reload preserves `installed_at`,
    so a manifest version bump doesn't toggle install state. Failures on
    individual files are skipped (returned in `result.skipped`) so one
    broken pack doesn't gate the rest.
  - **`pack-installer.ts`** — `installPack(packId, ctx)` and
    `uninstallPack(packId, ctx)` orchestrate across PacksStore +
    DashboardsStore + AgentStore (the latter optional). Reference-only
    ownership: install upserts missing agents from embedded YAML;
    uninstall removes only the dashboards.
  - **`packages/core/packs/starter.yaml`** — first built-in pack. Bundles
    the three dogfood agents from #199 (vimeo-staff-picks +
    weather-forecast + cat-video-finder) into two dashboards (Media +
    Weather). Auto-registers on daemon start; visible in PR 3's UI.

  Daemon startup (`packages/dashboard/src/index.ts`) now calls
  `loadBuiltinPacks(packsStore, defaultBuiltinPacksDir())` immediately
  after PacksStore init. Best-effort — failures don't block the
  dashboard from coming up.

  Added `packs/` to `packages/core/package.json`'s `files` array so the
  bundled manifest ships with the npm package.

  22 new unit tests; full suite 1017/1017 green.

- 9412fa4: Foundation for widget packs + dashboards (PR 1 of 5).

  Two new SQLite-backed stores in `packages/core`:

  - **`PacksStore`** — `packs` table holds pack registrations
    (`id, name, version, source, manifest_json, installed_at`). CRUD plus
    `markInstalled` / `markUninstalled` / `listInstalled`. Re-registering
    a built-in pack preserves its installed state across daemon restarts.
  - **`DashboardsStore`** — `dashboards` table holds named, ordered,
    sectioned views (`id, pack_id, name, layout_json, …`). CRUD plus
    `updateLayout`, `listByPack`, `listUserDashboards`, `deleteByPack`.

  Pack→dashboard cascade is handled explicitly via `deleteByPack`
  (no SQL FK) so the stores don't couple table-creation order.

  Both wired into `DashboardContext` (optional fields for now); no UI
  or routes consume them yet — that's PR 2 onwards. The
  "Default Dashboard" backing `/pulse` will be computed in PR 4, not
  stored here.

  Tests cover round-trips, install-state preservation across upsert,
  and explicit cascade behaviour.

- be4551f: Browse and install widget packs from the dashboard (widget-packs PR 3/5).

  New routes:

  - **`GET /packs`** — grid of all registered packs, split into Installed
    and Available sections. Cards show name, description, version, source,
    dashboard/agent counts.
  - **`GET /packs/:id`** — pack detail with manifest summary (dashboards
    by name + section count, agent ids) and an Install or Uninstall button.
  - **`POST /packs/:id/install`** / **`POST /packs/:id/uninstall`** — call
    the installer from PR 2; redirect back to the detail page with a flash
    banner reporting what changed.
  - **"Packs" entry in the top nav**, between Pulse and Settings.

  Plus a "clear-the-slate" pair on Pulse:

  - **`POST /pulse/hide-all`** — bulk-flip `pulseVisible=false` on every
    agent that has a signal block. Use case: "I want to install a pack
    and only see those tiles". Reversible.
  - **`POST /pulse/show-all`** — restores everything that was hidden.
  - **"Hide all" button** appears on the Pulse header when at least one
    signal is visible; flips to "Show all" when nothing is visible but
    hidden tiles exist.

  5 new route tests; full suite 1022/1022 green. Live smoke confirms
  install/uninstall round-trip + bulk hide/show.

- 3f7706b: Add `sua planner smoke` — automated end-to-end smoke tests for the build-planner pipeline.

  Hits a running daemon's HTTP endpoints, walks each scenario's poll + (optional) commit flow, asserts against the `planner_telemetry` row + response shapes the wizard expects. Real LLM calls are gated behind `--live` so neither CI nor a stray invocation burns budget.

  Six server-side scenarios cover the new critic-loop branches from the previous release: happy-path first-try clean, critic-retry on complex composition, the HN-digest signal.title regression reproducer, critic-exhaustion (3 attempts → "Commit anyway"), dismiss-without-commit, and the empty-commit gating fix. Two browser scenarios (`--browser`) drive the wizard via playwright to verify the warning flash + "Commit anyway" button label and dismiss-mid-retry cleanliness; playwright is loaded dynamically so non-browser users never pay the dep cost.

  Run `sua planner smoke` for a dry-run preview, `sua planner smoke --live` to actually execute. Output is one PASS/FAIL line per scenario plus a final summary; exit code 0 iff every selected scenario passed.

- 98a1031: Build-planner telemetry — `/metrics/planner` view + per-run record.

  The build-planner pipeline (`POST /agents/build` → poll → commit) was previously a black box: we couldn't measure how often plans extracted cleanly, how often `autoFixYaml` had to rescue an LLM mistake, or how plans-attempted mapped to plans-committed. This PR records one row per planner run in a new `planner_telemetry` table (sibling to `runs`, foreign-keyed with `ON DELETE CASCADE`) and surfaces aggregates at `/metrics/planner`.

  Captured per run: `plan_attempts` (1 today; PR2's critic-loop will increment), `plan_extract_status` (`ok` / `no-json` / `schema-invalid`), `plan_autofix_count`, `plan_validation_errors`, `time_to_plan_ms`, `time_to_commit_ms`, `committed_at`, `goal` (truncated to 1KB), `intent`.

  The headline metric — **first-attempt clean rate** — is the baseline for future quality work. PR2 (plan critic + auto-retry) and beyond can be measured against this.

- e628eff: Schedule is now editable from the agent's Config tab — previously you had to hand-edit YAML to set or clear a cron expression. New card shows the current cron expression, a human-readable summary (`Every day at 8:00 AM`), and a Save button that validates server-side via the same `validateScheduleInterval` the scheduler uses. Empty input clears the schedule. Sub-minute (6-field) cron is still rejected unless `allowHighFrequency` is set on the agent.

  Two latent bugs fixed along the way:

  1. **`allowHighFrequency` was being silently dropped on every save**: `extractDag` didn't include it, so even agents that declared `allowHighFrequency: true` lost it on every `upsertAgent`/`createNewVersion`, breaking the scheduler's frequency-cap exception. Now persisted via `AgentVersionDag`.
  2. **`updateAgentMeta` couldn't clear nullable fields**: it skipped any field whose value was `undefined`, conflating "key absent" with "key present, clear me." Switched the nullable fields (description, schedule, stateMaxBytes) to use `'key' in patch` so explicit-clear works.

- 1fcd534: Scheduler now fires v2 (DAG) agents — fixes silently-dropped wizard-built schedules.

  Until now the scheduler daemon only loaded v1 YAML agents from disk: every v2 agent built via the dashboard wizard (or `sua workflow import`) was silently skipped at load time, even though the dashboard's Scheduled widget cheerfully listed them with "last: never" and a green "Scheduler running" dot. The split came from `loadAgents` skipping any file with `id:` + `nodes:` (the v2 marker), with no other code path picking them up.

  `LocalScheduler` now accepts a parallel set of v2 agents plus a small dependency bundle, registers cron tasks for both v1 and v2 entries, and fires v2 agents directly through `executeAgentWithRetry` (the same path the dashboard's run-now and `sua workflow run` already use). The scheduler CLI now opens AgentStore + VariablesStore + EncryptedFileStore alongside the v1 loader and merges everything before starting.

  Also: scheduler heartbeat now distinguishes `idle` (alive, zero agents registered) from `running` (alive, at least one agent registered). The dashboard widget surfaces this with an orange dot and the label "Scheduler idle (0 agents registered)" so future cases of "daemon happy, nothing firing" are visible at a glance instead of silently green.

- 6ddff4f: State directory hardening.

  Three additions to the `$STATE_DIR` primitive shipped in PR D, addressing the most likely operational/correctness concerns:

  **1. Per-agent size cap** — new `agent.stateMaxBytes` field (default 100 MB; set 0 to disable). Pre-node check refuses to run when the dir exceeds the cap, with a clear error pointing to `sua state prune <agent>`. The node that _exceeded_ the cap completes; the _next_ node fails. This attributes the error to a fresh node rather than retroactively failing one that already finished.

  **2. `sua state` CLI** — four subcommands for operational hygiene:

  - `sua state list` — every agent with a state dir, sorted by size
  - `sua state du <agent>` — per-file breakdown
  - `sua state prune <agent>` — clear contents (or `--remove` the dir)
  - `sua state export <agent> [path]` — `tar.gz` to path or stdout

  **3. Audit trail** — additive `stateBytesBefore` / `stateBytesAfter` columns on `node_executions`. Captured per node when the agent has a state dir. Dashboard run-detail shows the delta as a small badge (`state +12 KB`) on each node when the value changed. Useful for spotting which node is growing state unexpectedly.

  Implementation notes:

  - `stateDirSize(id, dataRoot)` is a recursive synchronous walk; for typical agent state (a few files) it's microseconds. Symlinks are skipped (don't follow, don't count target size). Race-tolerant: silently skips files removed mid-walk.
  - `stateMaxBytes` is stored as a flat column on the `agents` table (alongside `pulse_visible`, `dashboard_visible`) — operator policy that shouldn't bump the agent version when changed.
  - The CLI uses system `tar` for `export` (avoids bundling a tar library for a rarely-used verb).

  Live smoke confirmed: cap enforcement refuses run 2 when state from run 1 exceeded 1-byte cap (status: failed, category: setup). Audit trail captured `0 → 6` bytes on the successful first run.

  Closes critical items 1, 2, 3 from the security roadmap entry added in PR D. Items 4–7 remain on the future-work list in `docs/SECURITY.md`.

- e71ba5e: `$STATE_DIR` primitive for stateful agents.

  Agents that need to persist data across runs (diff-over-time, caches, last-fired markers) get a per-agent directory at `data/agent-state/<agent-id>/`. Created lazily on first use, chmod 0o700, removed automatically when the agent is deleted.

  Available as:

  - `$STATE_DIR` env var in shell nodes (and as a string in any built-in tool input)
  - `{{state}}` template token in claude-code prompts and built-in tool inputs (e.g. `file-write`'s `path:`)

  ```yaml
  nodes:
    - id: diff
      type: shell
      command: |
        mkdir -p "$STATE_DIR"
        PREV="$STATE_DIR/last-readme.md"
        NEW="$STATE_DIR/current-readme.md"
        echo "$UPSTREAM_FETCH_RESULT" > "$NEW"
        if [ -f "$PREV" ] && ! diff -q "$PREV" "$NEW" > /dev/null; then
          echo '{"changed":true}'
        fi
        cp "$NEW" "$PREV"
  ```

  Promotes the convention agents had been inventing by hand (`.sua/state/<id>/`) into a first-class primitive. Surfaced by Round 2 dogfood Bug 8: the README diff agent invented its own state convention, and downstream agents would each invent a different one.

  **Cascading delete**: `agentStore.deleteAgent(id)` now also removes `data/agent-state/<id>/`. Idempotent (no-op when the dir was never created). State is **not** swept by the run-retention timer — it persists until the agent is deleted.

  **New `DagExecutorDeps.dataRoot`**: optional. When set, the executor exposes the state dir; when absent, `$STATE_DIR` is unset and `{{state}}` resolves to empty string. Tests and one-shot CLI runs typically omit it. Production paths (dashboard run-now / build / replay / widget-run, `sua workflow run` / `replay`) thread it through automatically.

  **Known limitation**: `sua schedule start` uses the v1 chain executor (via `LocalProvider`), not the DAG executor — scheduled agents going through that path don't get `$STATE_DIR` yet. The migration to the v2 path will pick this up.

  Sandbox: agent ids are validated against the lowercase+hyphens regex before path resolution; `removeStateDir` re-checks for defense in depth.

- c0b773f: Three new example agents that exercise the recently-shipped ai-template
  widget capabilities end-to-end:

  - **`vimeo-staff-picks`** — `ai-template` + `<iframe>` (player.vimeo.com,
    on the new sanitiser allowlist) + `{{#each}}` iteration + `replay`
    control. Renders the latest Vimeo Staff Picks as inline players.
  - **`weather-forecast`** — `dashboard` widget + `view-switch`
    (today/week) + `field-toggle` (extras) + `replay` (different city).
    Live wttr.in data; stress-tests every dashboard widget control type.
  - **`cat-video-finder`** — `ai-template` + `{{#if outputs.thumbnail}}` /
    `{{#unless outputs.url}}` + `replay` with input-tweak. Facade-pattern
    card around a YouTube search hit (clickable thumbnail, opens on
    YouTube).

  Together these cover all 7 capabilities that previously had zero
  in-repo examples: `replay`, `field-toggle`, `view-switch`, `{{#if}}`,
  `{{#unless}}`, `{{#each}}`, and `<iframe>` from the host allowlist.

- 539f569: Output widgets gain interactive controls.

  Agents can now declare a `controls:` array on `outputWidget` with three control types: `replay` (re-run inline, optionally with tweakable inputs), `field-toggle` (hide/show optional fields), and `view-switch` (tab-style switch between named field subsets — e.g. metric ↔ imperial). State lives in URL query params (`?wv=`, `?wh=`) so refresh resets to defaults and links can be shared. Renders on agent detail and run detail pages; Pulse tiles continue to render statically. The agent-builder prompt and discovery catalog teach the planner when to reach for each control type.

### Patch Changes

- 5610714: Dashboard: Agent Config tab UX cleanup.

  The per-agent Config tab (`/agents/<id>/config`) was a 7-card vertical stack ~2500px tall with seven competing primary buttons. This refactor cuts the page in half (~1400px), reorders sections by decision sequence (Variables → LLM → MCP → Secrets), promotes Variables to a full-width row above a two-column grid, collapses the heavyweight Output Widget and Notify editors when configured (with one-line "Set up" CTAs when not), and demotes gateway buttons so "Run now" is the only primary action above the fold. The agent Status dropdown moves to the page header next to "Run now" so lifecycle decisions live where runs are triggered. Persistence paths and form actions are unchanged.

- 3c77e9e: Dashboard: toggle MCP exposure from the agent Config tab.

  A new card on `/agents/<id>/config` flips `mcp: true/false` without editing YAML. Off → "Expose via MCP" button; on → "exposed" badge + "Stop exposing" button. The flip rewrites the agent record but does not restart the running MCP server — the form copy points at Settings → MCP for that.

- 1cba377: Dashboard: move Output Widget editor to its own page with sub-tabs, and make Preview match Pulse.

  The Output Widget editor was a ~1200px inline section on the Config tab — widget-type cards, contextual helper, field table, AI-template branch, interactive-mode subform, action bar, and live preview all stacked in one form. It now lives at `/agents/<id>/output-widget` with sub-tabs **Type**, **Fields**, **Interactive**, and **Preview** filtering which sections are visible. The action bar (Save / Remove) stays visible across all tabs. Save and validation errors return you to the editor (preserving iteration) instead of bouncing to Config. The Config tab's Output Widget card collapses to a one-line summary (`Type: dashboard, Layout: 5 fields, Interactive: yes`) plus an "Edit" link.

  Preview now respects `interactive: true`. When the editor's Interactive checkbox is on, the Preview tab renders the same `renderInteractiveWidget` Pulse uses (with the configured runInputs filter, askLabel, and replayLabel applied) — in `staticPreview` mode so clicks don't accidentally submit a real run. Previously the preview always rendered the static widget output, hiding the visual effect of every Interactive setting.

- 62e7a01: Fix `spawn E2BIG` on claude-code nodes with large upstream outputs.

  `claude-code` nodes were spawned with the resolved prompt as a single argv element AND with every upstream node's full result copied into env vars (`UPSTREAM_<ID>_RESULT`). When `{{upstream.X.result}}` substitution produced a fat prompt — typical for any agent whose upstream shell node returns a JSON payload or HTML page — `argv + env` total exceeded the kernel's `ARG_MAX` (~256KB Linux, lower under sandboxes), and `execve()` failed with `spawn E2BIG`. Surfaced loudly on `ashby-job-finder` running under a parent loop: any iteration whose company had a meaty job board (e.g. `ashby`, `zip`) failed instantly.

  Two changes:

  1. **Prompt rides on stdin instead of argv.** `claudeSpawner` / `claudeTextSpawner` no longer include the prompt as a positional arg; `spawnProcess` opens stdin as a pipe (new `stdinInput?: string` option) and writes the prompt. Claude CLI in `--print` mode reads from stdin natively.
  2. **`UPSTREAM_*_RESULT` env vars are stripped before exec for claude-code nodes.** They were already consumed at template-substitution time; passing them to claude was redundant bytes that contributed to the same ARG*MAX cap. Shell nodes still receive these env vars (intended consumer: `$UPSTREAM*<ID>\_RESULT` references).

  Codex spawner is left untouched in this PR (its CLI's stdin support hasn't been verified) — same fix applies and is tracked as a fast-follow.

- 726c856: CSP `frame-src` and `img-src` were missing the Vimeo + youtube-nocookie
  hosts that the iframe sanitizer's allowlist permits. The browser
  silently blocked Vimeo iframes (and their poster images) even though
  the sanitizer rendered them. Added `https://player.vimeo.com` and
  `https://www.youtube-nocookie.com` to `frame-src`, plus
  `https://i.vimeocdn.com` to `img-src` for the Vimeo CDN's posters.

  CSP block now mirrors the host allowlist in
  `packages/core/src/html-sanitizer.ts:IFRAME_ALLOWED_HOSTS`. Comment
  above the directive flags this — any future host added to the
  sanitizer must also be added here or it'll silently 4xx in browsers.

- 1531948: Dashboard: split `routes/agents.ts` and `views/agent-detail-v2.ts` into per-feature files.

  Internal refactor with no behaviour change. The 441-line agents router becomes a 22-line composition over six per-action modules under `routes/agents/`. The 466-line agent-detail view becomes a barrel over six per-tab renderers under `views/agent-detail/`. Adding new agent surfaces no longer requires scrolling through unrelated code.

- 934c1f9: Bring `/dashboards/:id` to parity with Pulse for tile-level controls.

  Tiles on a stored dashboard now get the same chrome as Pulse tiles:

  - **Configure tile** (already worked — listener is global).
  - **Palette cycle** with persistence (was renderless on dashboards).
  - **Resize handle** with persistence (didn't work at all on dashboards).
  - **Collapse / expand** with persistence (didn't work at all).
  - **"Edit layout" toggle** in the dashboard header reveals resize handles
    and delete buttons, mirroring Pulse's edit mode.
  - **× remove button**: when rendered on a dashboard, the × now removes
    the tile from THAT DASHBOARD's section (POSTs to the existing
    `/sections/:idx/tiles/:tileIdx/delete` endpoint) instead of toggling
    the agent's global Pulse visibility. Pulse's × keeps its old semantic.

  Cosmetic state (palette / size / collapsed) is persisted to localStorage
  keyed per-dashboard (`sua-dashboard-<kind>-<id>`), matching Pulse's
  client-state model. Server still owns section structure (which is
  edited via `/dashboards/:id/edit`'s up/down + add/remove flow).

  Implementation:

  - `widgetLayoutJS` gained an optional `runtimeKeySuffixAttr` that
    appends a host-element attribute value to all storage keys at
    runtime — so a single global JS bundle can serve every dashboard
    page with isolated state.
  - New `DASHBOARDS_LAYOUT_JS` module composes `widgetLayoutJS` with
    dashboard-specific element ids + a per-dashboard collapse handler.
  - `tileWrap` now accepts an optional `TileWrapContext` that controls
    the × button's form action.
  - The dashboards view renders a `#dashboard-containers` host with
    `data-dashboard-id`, embeds tile data in
    `<script id="dashboard-tile-data">`, and adds an "Edit layout"
    button next to the existing "Edit sections" link.

  Out of scope (deferred): drag-drop tile reorder + add-container —
  the existing `/dashboards/:id/edit` page covers section structure
  with up/down arrows.

  Tests bumped; full suite 1066/1066.

- 6d683f0: Output widgets now synthesise a default "Run again" control when no replay is declared.

  Authoring an output widget previously required adding `controls: [{type: replay}]` in YAML to get a Re-run button on the agent / run detail pages. Most authors forgot, so most widgets shipped without one. The button now synthesises automatically when (a) the renderer is invoked with a `controlState` (i.e. a detail-page render, not Pulse / home / interactive tile), and (b) the schema has no `replay` control declared.

  The synthesised control is wired with the agent's declared `inputs[*]` names so the inline form lets users tweak inputs before re-running. Authors who declared a custom replay (with custom label or input subset) keep their config.

- c04594f: Switch the two remaining dogfood agents to `signal.template: widget`
  so their dashboard tiles render the full output widget instead of a
  compact text-headline.

  `weather-forecast` and `vimeo-staff-picks` previously used
  `text-headline`, which surfaced just temperature/condition or
  `fetched_at` on tiles — none of the view-switch / field-toggle /
  replay / iframe machinery the agents were specifically built to
  showcase. `cat-video-finder` was already on `template: widget` and
  served as the proof. With this change all three demo tiles now
  render their full widgets, matching their behaviour on the agent
  detail page.

  Each YAML gained a comment explaining the trade-off: `text-headline`
  is the compact alternative for high-density Pulse layouts.

- 66c5394: Add `allow-same-origin` to the iframe sandbox so YouTube/Vimeo embeds can
  load posters and play-button overlays.

  YouTube's embed page hits its own origin's storage on init to render the
  poster image and player chrome. Without `allow-same-origin`, those calls
  fail and the iframe shows blank. Safe under the existing host allowlist
  invariant: every approved host is a third-party origin (youtube.com,
  vimeo.com), so granting same-origin lets the embed reach **its own**
  cookies, never ours. Locked the invariant in a comment so future hosts
  can't be added on the dashboard's origin without explicit review.

- 5b6267b: `{{inputs.X}}` in `loop` / `agent-invoke` `inputMapping` now resolves YAML-declared input defaults.

  The dashboard's run handler builds `options.inputs` from `input_*` form fields only — it does not merge in the agent's declared `inputs:` defaults. Per-node env construction applies defaults later, so single-node agents always saw their defaults. But composition node types (`loop`, `agent-invoke`) resolve `{{inputs.X}}` at the control-flow layer using `parentOptions.inputs` directly — which contained user-supplied values only.

  Effect: when a user ran a parent agent without supplying every declared input, any composition node referencing `{{inputs.X}}` for an unsupplied X passed empty string to the sub-run. The orchestrator's loop fanned out N times with empty `JOB_QUERY` even though the YAML declared a default.

  Both call sites now merge `parentAgent.inputs[*].default` into the resolved map before substitution, with user-supplied values still winning.

- 2ef8e44: Pulse tiles for parameterized agents now ship with the inputs form + re-run button by default.

  The flag (`outputWidget.interactive: true`) was always available, but neither the agent-builder nor the build-planner prompted the LLM to set it — so every wizard-built search/lookup agent rendered as a static tile on pulse, with the re-run UI only available on the `/agents/<id>` detail page. The agent-builder + build-planner prompts now both instruct the model to set `interactive: true` whenever the agent declares runtime `inputs:`.

  Also flips the flag on `agents/examples/ashby-job-finder.yaml` so it benefits immediately.

- 85e01ee: mcp-server: fix crash on the second client connection.

  The MCP server reused a single `McpServer` instance across all sessions and called `server.connect(transport)` on it once per new session. The MCP SDK requires a fresh server per transport — the second connect threw `Already connected to a transport`, surfaced as an unhandled HTTP-parser exception, and crashed the process. Symptom: `claude mcp list` (or any second client) reported `Failed to connect` and `daemon status` showed the MCP service as `stale (pid dead)`. Now each session gets its own `McpServer`; `provider` and `agentDirs` are still shared. Closing the session also closes its server.

- 343242e: `startMcpServer` now returns a `{ shutdown }` handle so callers (tests, CLI, embedders) can stop the listening http server cleanly.

  Pre-fix it returned `void`, leaving callers no way to drain the server. Two MCP test describe blocks ran random-port servers per test and never shut them down — across CI runs the random-port pool occasionally collided and a fresh test ended up talking to a prior test's still-running server (whose agentDir had been rm'd), surfacing as flaky `Agent "..." not found`. The planner-telemetry PR (#224) added enough test load to shift ordering and trip the latent flake reliably.

  `shutdown()` closes all live MCP transports, drains the provider, and awaits `httpServer.close()`. Also tightened the initial `listen()` to await the bind and surface listen errors instead of fire-and-forget.

- 63e9eb6: Make `startMcpServer().shutdown()` use `httpServer.closeAllConnections()` instead of per-session `McpServer.close()`.

  #225 added a `shutdown()` handle so tests could stop the listening http server, which fixed the EADDRINUSE flake. But the `for entry of sessions: await entry.server.close?.()` loop raced SDK transport teardown against the next test's first request, surfacing as a different flake: `TypeError: fetch failed — SocketError: other side closed`. The Release workflow tripped this on the post-#225 main push.

  Conservative fix: drop the per-session McpServer close, just `httpServer.closeAllConnections()` + drain provider + await `httpServer.close()`. Releases the port without poking at SDK internals. 10/10 stress runs of the file pass locally.

- 5fd8e74: Tidier `/nodes` catalog page.

  Cards are now collapsible (default collapsed), grouped by category (Execution / Control flow / Terminal), with a top toolbar that has a live filter (matches type, description, use-when, field names) plus collapse-all / expand-all buttons. Anchor chips at the top jump straight to a node type. Filter and per-card open state persist in sessionStorage so anchor clicks don't lose context.

- a5d41c1: Accept shorthand string form for `outputs:` declarations.

  LLM-generated YAML routinely writes `outputs.url: string` (the shorthand) instead of the verbose `outputs.url: { type: string }`. The schema now accepts both forms — the parser normalises the shorthand to the verbose object form, so downstream consumers always see the canonical shape. Fixes the painful "Fix with AI" loop where every Suggest improvements run hit the same `Expected object, received string` validation wall.

  The autofixer (run-now-build → autoFixYaml) also rewrites shorthand to verbose form so the canonical stored YAML stays stable in git.

  Camel-case output names (`mediaType`) still need to be renamed to snake_case (`media_type`) by hand — the schema can't auto-coerce keys without breaking template references.

- 62ccfdc: Two related Build-from-goal fixes that surfaced from a real-user dashboard
  where the planner hallucinated an agent id and the wizard still created
  the dashboard pointing at it.

  **A. Discovery catalog includes draft agents.** `buildAgentsSection`
  previously filtered to `status: 'active'` only, so any agent the user
  had scaffolded but not yet activated was invisible to the planner.
  Result: when the goal mentioned "the ashby job search," the planner
  couldn't see the user's draft `ashby-job-finder` and invented
  `ashby-job-hunter` instead. Drafts are now included, marked
  `(draft)` in the catalog so the LLM treats them as work-in-progress
  candidates rather than hidden. Cap raised from 20 → 30 agents.

  **B. Commit refuses to create a dashboard whose tiles reference
  agents that didn't land.** Previously each agent in `newAgents` had
  its YAML parsed/upserted independently; failures went into
  `agentsSkipped[]` but the dashboard was still upserted, leaving the
  user with empty "not installed" placeholder cards and no clear cause.
  The commit now checks every `dashboard.sections[].agentIds[]` against
  both the just-created agents AND the existing AgentStore. If any are
  unmet, the dashboard is NOT created and `dashboardError` includes the
  ids and the per-agent skip reasons.

  3 new tests (catalog draft inclusion, archived exclusion, commit
  integrity check); full suite 1075/1075 green.

- b07f1bb: Two daily-greeting dogfood bugs:

  1. **Inline replay form now honours input specs.** The Re-run button's inline input fields previously rendered as bare `<input type="text">` with no value attribute and no enum awareness — so `daily-greeting`'s `NAME` input showed empty even though the YAML declared `default: friend`, and `STYLE` was a free text field instead of a dropdown of its declared `enum` values. The renderer now mirrors the wizard form: `<select>` with options for enum/boolean, `value=spec.default` pre-fill for everything else.

  2. **`{{inputs.X}}` in shell commands now auto-fixed in both forms.** The build-planner sometimes generates shell commands using `{{inputs.X}}` template syntax (correct for claude-code prompts, wrong for shell). `autoFixYaml` already rewrote the canonical form to `$X`; it now also catches the space-escaped `{ {inputs.X}}` form that the template-substitution pipeline produces when planner output is piped through `{{upstream.X.result}}`. Plus a planner-prompt update so this generation mistake should happen less often: the catalog now explicitly contrasts shell `$VAR` vs claude-code `{{inputs.X}}` syntax.

- 746b1e5: Run detail: sticky DAG + result summary while scrolling node logs.

  The DAG visualization and result widget at the top of `/runs/:id` now stick to the viewport (capped at 60vh) while the node-execution panel scrolls below. On long runs with many nodes you keep the graph and final output in view instead of having to scroll back up. Falls back to a non-sticky stacked layout below 900px wide.

- 6a2088a: Three planner-pipeline bugs surfaced by the new `sua planner smoke` command.

  **`PlannerTelemetryStore.fromHandle` field-init bug.** Class-field initialisers (`private readonly retryAliases = new Map()`) only run inside `new` — `Object.create` skipped them, so any call into `resolveOriginalRunId` / `recordRetrySpawn` on a `fromHandle`-built store crashed with `Cannot read properties of undefined (reading 'get')`. The wizard always uses the constructor path so this only surfaced for CLI consumers.

  **`survey.existingDashboards` string-array shape.** The real planner sometimes emits `existingDashboards: ["dash-id-1", "dash-id-2"]` instead of the canonical `[{id, name?, reason?}]` objects. The schema now accepts either form, coercing strings into the canonical shape so the rest of the plan still validates.

  **Smoke command auth.** `sua planner smoke --live` was hitting `/agents/build` without a session cookie and getting "Missing session cookie" on every scenario. The runner now reads the dashboard token via `readMcpToken()` and threads it onto every authenticated request. Two scenarios (1 and 4) had over-strict asserts that fought the planner's stochasticity; they now PASS-with-informational-note when the planner happens to skip a branch instead of hard-failing.

- dc9e0f1: Styled 404 page that wraps the standard layout (topbar, theme toggle,
  suggestion cards) instead of the previous bare `<p>Not found</p>` scrap.

  The catch-all in `index.ts` and the unknown-id paths in the new
  dashboards routes now render `renderNotFoundPage`. Shows the requested
  path (HTML-escaped), an optional context message, and a card list of
  common destinations (Agents / Pulse / Packs / Runs).

- Updated dependencies [5c2e83f]
- Updated dependencies [0042d16]
- Updated dependencies [5610714]
- Updated dependencies [3c77e9e]
- Updated dependencies [1cba377]
- Updated dependencies [0a73abe]
- Updated dependencies [4ca3edf]
- Updated dependencies [0745598]
- Updated dependencies [9b482b6]
- Updated dependencies [b2f5498]
- Updated dependencies [c2b6ad5]
- Updated dependencies [cd21018]
- Updated dependencies [60a4f40]
- Updated dependencies [62e7a01]
- Updated dependencies [2f0aa90]
- Updated dependencies [726c856]
- Updated dependencies [5e5f5e9]
- Updated dependencies [1531948]
- Updated dependencies [934c1f9]
- Updated dependencies [cc44352]
- Updated dependencies [be4551f]
- Updated dependencies [6d683f0]
- Updated dependencies [c04594f]
- Updated dependencies [38f2da6]
- Updated dependencies [6065e6c]
- Updated dependencies [66c5394]
- Updated dependencies [5b6267b]
- Updated dependencies [475f28d]
- Updated dependencies [2ef8e44]
- Updated dependencies [098bf28]
- Updated dependencies [6e96119]
- Updated dependencies [96b1089]
- Updated dependencies [bea09e7]
- Updated dependencies [0f93483]
- Updated dependencies [85e01ee]
- Updated dependencies [343242e]
- Updated dependencies [63e9eb6]
- Updated dependencies [9bcce23]
- Updated dependencies [5fd8e74]
- Updated dependencies [29b524f]
- Updated dependencies [3508c50]
- Updated dependencies [a5d41c1]
- Updated dependencies [647e172]
- Updated dependencies [be4551f]
- Updated dependencies [9412fa4]
- Updated dependencies [be4551f]
- Updated dependencies [62ccfdc]
- Updated dependencies [3f7706b]
- Updated dependencies [98a1031]
- Updated dependencies [b07f1bb]
- Updated dependencies [746b1e5]
- Updated dependencies [e628eff]
- Updated dependencies [1fcd534]
- Updated dependencies [6a2088a]
- Updated dependencies [6ddff4f]
- Updated dependencies [e71ba5e]
- Updated dependencies [dc9e0f1]
- Updated dependencies [c0b773f]
- Updated dependencies [539f569]
  - @some-useful-agents/core@0.20.0

## 0.19.0

### Minor Changes

- 16e3a74: `sua agent install <url>` — fetch + validate + import an agent over HTTPS.

  End-to-end install flow for sharing agents. The CLI verb fetches a YAML, validates against `agentV2Schema`, and writes through the same `upsertAgent` path that `sua workflow import-yaml` uses (DB-backed). The dashboard ships a paste / preview / confirm form at `/agents/install`, mirroring the v0.18 MCP import idiom.

  - `core/registry`: GitHub `/blob/<branch>/<path>` URLs are normalized to `raw.githubusercontent.com`; `gist.github.com/<user>/<id>` is resolved via the `/raw` redirect; plain HTTPS passes through. Size cap (256 KB) and 10-second timeout. URL gated by `assertSafeUrl` before fetch — link-local and loopback hosts are blocked.
  - CLI accepts `--from-gist`, `--auth-header "Bearer ..."` for private fetches (never persisted), `--yes` for non-interactive runs (refuses overwrite without `--force`), and `--force` to upgrade an existing id. ID-collision diff prompt shows declared inputs / secrets / mcp / schedule before confirming.
  - Trust model: install never auto-runs. `source` is always set to `local` regardless of what the YAML declares — the installer takes ownership. Community-host allowlist is deferred until a trusted host actually exists.
  - Dashboard `/agents/install` — three-step paste/preview/confirm form. Same `Authorization` header support as the CLI; never persisted.
  - A `vitest.config.ts` resolve alias is added so cross-package tests resolve workspace packages to source TS without a rebuild step.

  Pairs with the source-on-upgrade fix that ensures the installer-takes-ownership invariant holds across upgrades, not just initial installs.

- 76411f7: Two key shipped agents rewritten, plus a parser fix that was silently breaking both.

  **Parser fix.** `parsedToAgent` and `NODE_KEY_ORDER` in `agent-yaml.ts` had drifted from the v0.16+ schema, silently stripping `tool`, `action`, `toolInputs`, `onlyIf`, `conditionalConfig`, `switchConfig`, `loopConfig`, `agentInvokeConfig`, and `endMessage` from every YAML round-trip. Same shape as the `outputWidget` drift fix in #167. Any agent using MCP-driven tools or control-flow nodes lost those fields on import — so `graphics-creator-mcp` arrived in the DB as a sequence of bare `claude-code` nodes with no prompts, and `agent-analyzer`'s `onlyIf` skip-on-valid optimisation never fired because the field was dropped. Two new round-trip tests lock down every node field the schema accepts so the next addition can't slip through silently.

  **graphics-creator-mcp** — single-node rewrite. The previous 6-node theme → save → render → composite pipeline carried multiple latent bugs (missing prompts, broken upstream wiring, theme step that produced nothing reusable). New version is one `claude-code` node that calls the modern-graphics MCP server's `list_themes` + `generate_graphic` tools in one round-trip, returns structured JSON, and ships with an interactive output widget so the tile becomes a self-contained ask → render → preview loop on `/pulse`.

  **agent-analyzer** — three improvements to the "Suggest improvements" agent:

  - `fix` node now skips entirely when validate's `valid` field is true (saves a Claude round-trip on the happy path; this was already declared but didn't survive parsing — now does).
  - `fix` timeout raised from 90s to 240s and `maxTurns` from 2 to 4.
  - `fix` prompt rewritten to be tighter: leads with the validation error in an explicit fence, includes common fix recipes (shell-vs-template upstream refs, uppercase input names, missing enum values, control-flow configs), and emphasises "minimal change" so Claude doesn't try to redesign the agent on every fix attempt.

  **Dashboard fix-attempt fallback** — the inline auto-fix used by the "Suggest improvements" modal had `timeout: 60s` / `maxWait: 65s` / `maxTurns: 1`, no slack for any non-trivial agent. Bumped to `timeout: 180s` / `maxWait: 200s` / `maxTurns: 3`. When the auto-fix still doesn't return in time, the new error message points users to "Edit manually" with the suggested rewrite as a starting point, rather than implying the dashboard is broken.

- 16e3a74: `sua daemon` — run schedule, dashboard, and (optional) MCP as detached background services.

  New top-level CLI verb with `start | stop | restart | status | logs` subcommands. PIDs and rotated logs live under `<dataDir>/daemon/`; existing scheduler heartbeat is reused for health detail. Detached subprocesses re-invoke the local `sua` binary with the corresponding verb so config and env propagate cleanly.

  - `sua daemon start` spawns the configured services, waits for them to settle, then reports per-service `started` / `crashed on startup` (with log path) / `already running`. Children that crash are caught by a post-spawn liveness check, not silently presented as running.
  - `sua daemon status` shows pid + scheduler heartbeat + a clickable URL column for services that bind a port. URLs render as OSC 8 hyperlinks in TTY-aware terminals; non-TTY contexts (pipes, file redirects) emit plain text. Dashboard URL embeds `/auth#token=<token>` so a click in a fresh browser completes the auth handshake without bouncing through a sign-in page.
  - New optional `daemon` config block: `services` (default `[schedule, dashboard]`), `logRotateBytes` (default 10 MB), plus separate `dashboardPort` (default 3000) and `dashboardBaseUrl` (default loopback) fields. Daemon now passes `--port` through to `dashboard start` and `mcp start` so configured ports actually take effect under supervision.
  - The scheduler now idles instead of exiting when zero agents have a `schedule:` field, so the daemon can supervise a dashboard-only project without the schedule slot flickering "stale (pid dead)".
  - Dashboard `startDashboardServer` rejects its listen promise on `'error'` events (e.g. EADDRINUSE) instead of hanging — the previous behavior left the daemon thinking the dashboard was running while it never bound.

  Closes the "schedules don't fire when the terminal closes" gap from the v0.19 operationalization plan.

- 16e3a74: Notify Slack messages now include a clickable run link.

  The notify dispatcher already supported a run-link in Slack Block Kit messages — the slack handler builds `<base/runs/<id>|Open run in dashboard>` when `dashboardBaseUrl` is on the dispatch context. Earlier release just never wired that field from any of the four sites that call `executeAgentDag`, so the link never rendered in practice.

  End-to-end plumbing in this release:

  - New optional `dashboardBaseUrl?: string` field on `SuaConfig` plus a `getDashboardBaseUrl()` helper that falls back to `http://127.0.0.1:<dashboardPort>`. Override when the dashboard is behind a reverse proxy or bound to a non-loopback host that the notify destination needs to reach.
  - `sua workflow run` and `sua workflow replay` pass the resolved base URL into executor deps.
  - `startDashboardServer` accepts an optional `dashboardBaseUrl` (CLI passes it from config; tests can override). Stored on `DashboardContext` (default `http://<host>:<port>` if not supplied). Run-now and replay routes thread `ctx.dashboardBaseUrl` into executor deps.
  - Integration test asserts the slack handler payload contains the expected dashboard link when `dashboardBaseUrl` is set on deps.

- e0b4d96: Interactive widgets — turn pulse tiles into mini-apps.

  Output widgets gain an opt-in `interactive: true` flag. When set, the pulse tile renders with an inline inputs form + Run button + state machine that polls `/runs/:id/widget-status` until the run completes — no navigating away. Each tile becomes a self-contained ask → think → answer → ask again loop with smooth CSS transitions between states.

  Five visible states (`idle | asking | running | success | error`) cross-fade at ~220 ms with a `transform: translateY` so content doesn't pop. The tile gets a subtle pulsing border while running so it reads as "active" at a glance from the pulse page. `prefers-reduced-motion` disables the animations.

  Schema additions on `outputWidget` (all optional):

  - `interactive: boolean` — opts the tile into the new mode
  - `runInputs: string[]` — subset of `agent.inputs` to expose in the form (defaults to all)
  - `askLabel: string` — overrides the initial Run button text (default "Run")
  - `replayLabel: string` — overrides the post-result button text (default "Run again")

  Two new dashboard routes:

  - `POST /agents/:name/widget-run` — accepts `input_*` form fields and returns `{ runId }` JSON. Reuses the existing DAG executor and auth.
  - `GET /runs/:id/widget-status` — lightweight `{ status, result, error }` JSON polled every 500 ms.

  Polling caps at 60 s (120 ticks) → tile transitions to a "still running, view details" state with a link to `/runs/:id`. Cancel button hooks the existing `/runs/:id/cancel` route.

  The output widget editor on agent config gains an "Interactive mode" disclosure: a checkbox to enable, checkboxes per declared input to filter what the tile shows, and label overrides for both buttons.

  Non-interactive widgets are completely unchanged. Existing widgets without the flag render in the same static mode they always have.

  Plan: `~/.claude/plans/interactive-widgets.md`.

  Out of scope (deferred):

  - Widget cross-fade replaces the result with the raw text in a `<pre>` for now; live re-render of the actual widget HTML on completion is a follow-up (the next pulse refresh swaps in the proper widget).
  - Streaming intermediate node outputs into the tile.
  - Channel/file/secret pickers tied to specific input types beyond text/number/enum/boolean.

- 4c8de94: Form-based notify editor for the dashboard.

  Replaces the JSON textarea on agent config with a structured form. Top-level checkboxes for `on` (failure/success/always), a comma-separated list for declared `secrets`, and per-handler cards with type-specific fields:

  - **slack** — `webhook_secret` dropdown (populated from the secrets list), `channel`, `mention`
  - **file** — `path`, `append` checkbox
  - **webhook** — `url`, `method` (POST/PUT), `headers_secret` dropdown (optional, also populated from the secrets list)

  Three "+ Add slack / + Add file / + Add webhook" buttons let operators compose the handler array without remembering schema field names. Removing a handler is an in-row "Remove" button. Saving serializes the form state to a single hidden `notify_json` field; the route validates the payload through the same `agentV2Schema` as the YAML import path so cross-checks (e.g. handler-referenced secrets must be declared) still fire.

  Backwards compat: the route accepts either the new `notify_json` field (preferred) or the legacy `notify` JSON blob — ad-hoc API callers and existing tests aren't broken.

  Out of scope (future): live Block Kit preview for slack handlers; channel picker via Slack OAuth (depends on PR-C); secret-name autocomplete (the cross-check at save time covers typos).

- 16e3a74: `notify:` field on agent v2 — fire user-declared handlers on run failure / success / always.

  After a DAG run commits its final state, the executor dispatches handlers in parallel and isolated. A broken Slack webhook can never turn a successful run into a failed one — handler exceptions are caught, logged via the existing logger, and never propagate back into the run.

  Three builtin handler types:

  - **slack** — POSTs a Block Kit message to a Slack incoming webhook URL stored as a secret. Headline (status emoji + agent name + status), agent id / run id / start+complete timestamps, last 200 chars of error if failed, and (when `dashboardBaseUrl` is configured) a clickable link back to the run page. Optional `mention` and `channel` fields.
  - **file** — appends a JSON line per fire to a project-cwd-scoped path. Reuses the file-write builtin's path-traversal guard.
  - **webhook** — generic `POST` with body `{ agent, run_id, status, started_at, completed_at, error?, output? }`. Optional secret-backed `Authorization` header. URL gated by the existing `assertSafeUrl` SSRF guard.

  Schema corrects the original plan's assumption that `{{secrets.X}}` templates work in handler config: secrets in this codebase are env-var-only at the node level, so notify config declares its own `secrets:` list and the dispatcher resolves values from the secrets store. A zod cross-check rejects handlers that reference an undeclared secret. `{{vars.X}}` template substitution works in string fields like `channel`, `path`, and `url` via the existing template helpers.

  Dashboard agent config gets a JSON-textarea editor for the notify block and a `POST /agents/:name/notify/update` route alongside the existing widget editor pattern. Email handler intentionally not in this release — defer until Slack proves the pattern.

- 12627d1: `sua workflow rm <id>` and dashboard delete — hard-delete agents.

  Closes the gap where `archive` was the only way to "remove" a v2 DB-backed agent. Archived agents stayed visible in `sua workflow list` and held the id namespace, making test fixtures and abandoned agents hard to clean up.

  - New CLI verb `sua workflow rm <id>` shows agent metadata (status, source, version count, run count + last fire, schedule), then a `[y/N]` confirmation prompt. `--yes` skips the prompt for scripts.
  - New dashboard "Danger zone" disclosure section on the agent overview tab. The form requires the operator to **type the agent id verbatim** before the browser will submit — the input's `pattern` attribute enforces the exact match. The route also re-validates the confirm token server-side, so a client bypassing the form still can't accidentally delete.
  - Both surfaces use the existing `AgentStore.deleteAgent`, which cascades to `agent_versions` rows but leaves runs intact (runs reference agent id as a string, no FK). Run history is preserved as append-only — clicking the agent column in /runs for a deleted agent now 404s with a "this agent has been deleted" hint, but the run row itself is still inspectable.

  Refuses to delete an agent that's invoked by another agent's `agent-invoke` node (existing core behavior — the error message names the dependent agents). No `--purge-runs` or cascade-runs flag; orphan-cleanup is a separate utility (deferred).

### Patch Changes

- 77ab55b: Fix YAML round-trip silently stripping `outputWidget` fields.

  `agent-v2-schema.ts` carried its own inline `outputWidget` zod definition that had drifted from the canonical `outputWidgetSchema` in `output-widget-schema.ts`. Anything that round-tripped agents through YAML (`workflow import-yaml`, `agent install`, `workflow export` → re-import) lost the missing fields silently because zod accepted the document but the inline definition didn't list those keys.

  Drift accumulated over time:

  - `ai-template` widget type
  - `preview` field type
  - `prompt` and `template` fields (ai-template generator output)
  - `interactive`, `runInputs`, `askLabel`, `replayLabel` (PR #166)

  Fix: the inline schema is replaced with `outputWidgetSchema.optional()` so there's a single source of truth.

  Surfaced when adding `interactive: true` to the Magic 8-Ball agent via `workflow export → patch → workflow import-yaml` and observing the field disappear on re-export. Also fixes the latent bug where ai-template widgets authored via the dashboard couldn't survive YAML round-trip — they parsed cleanly but the prompt/template fields were stripped.

  No agent data migration needed; existing DB-stored widgets keep their fields and now correctly survive a YAML round-trip.

- 16e3a74: Fix `sua agent install` not propagating `source: local` when upgrading an existing agent.

  The install path explicitly built its upsert payload with `source: 'local'` to honor its installer-takes-ownership contract, but both branches of `upsertAgent` (metadata-only update when DAG unchanged, new-version creation when DAG differs) called `updateAgentMeta` with a patch that omitted `source`, and `updateAgentMeta`'s type signature didn't accept it either. So an existing row with `source: 'examples'` would stay `examples` even after `sua agent install --force`, quietly violating the documented contract.

  `updateAgentMeta` now accepts `source` and writes it. Both `upsertAgent` paths pass `agent.source` through. New test in `AgentStore.upsertAgent` covers source change across both upsert paths (identical DAG → metadata-only update; differing DAG → new version).

  Initial installs of new agents were unaffected — `createAgent` honored `agent.source` directly. Only upgrades hit the bug.

- a7d1bf0: Fix `/agents` list page silently dropping flash banners.

  Mutation routes that redirect to `/agents?flash=...` (e.g. the new hard-delete from PR #162) had their messages dropped — the GET handler never read `req.query.flash` and `AgentsListInput` had no `flash` field, so the `layout()` call rendered without a banner. Users would delete an agent and see nothing change visually beyond the agent disappearing.

  Wires the `flash` end-to-end: route reads `req.query.flash` (kind=ok) and `req.query.error` (kind=error), `AgentsListInput` accepts the optional banner, and the layout renders it via the existing `flash--ok` / `flash--error` styles already used by `/runs`. Test added.

  Same pattern as `/runs` and the agent detail page already use; agents-list was the odd one out.

- 16e3a74: Add `.claude/` to `.gitignore` so subagent worktree directories from Claude Code sessions can't accidentally land in commits as embedded git repositories.

  No runtime impact; repo-hygiene only.

- 3d42b6b: Fix interactive widgets rendering raw JSON in a `<pre>` on completion.

  PR #166's interactive widgets shipped with a known follow-up: when a run completed in the tile, the result body got pretty-printed JSON instead of the actual widget. The proper widget render only appeared on the next pulse refresh, which broke the in-place feel — the whole point of interactive mode.

  Fix: `GET /runs/:id/widget-status` now server-renders the agent's `outputWidget` against the run result and includes a `widgetHtml` string in the response when the run is `completed` and the agent has a widget. The tile JS swaps that HTML into the result box on success, with the same fade-in transition as before. Falls back to the prior `<pre>` behavior when no widget is configured (e.g. agent without an outputWidget) or the widget renderer rejects the result.

  Same renderer that powers the static pulse tile now runs on the widget-status endpoint, so the rendering is identical between first-load and post-run states. No client-side widget logic to keep in sync.

- be8ef64: Fix interactive widgets resizing during state transitions.

  PR #166's interactive widgets used `display: none` to hide inactive panes (asking / running / success / error / stuck), which removed them from the layout entirely. That meant the tile's height jumped between states — the form pane is one height, the spinner-only running pane is much shorter, the result is variable, the error card is somewhere in between. Asking → running → success felt jarring as the container resized twice.

  Fix: switch to a CSS Grid stack. All panes share the same grid cell (`grid-template-areas: 'stack'`), so the cell's height is `max(child heights)` and stays stable across transitions. Inactive panes get `opacity: 0; visibility: hidden; pointer-events: none` instead of `display: none`, so they keep contributing to the cell sizing without affecting interaction. CTA rows also pin to the bottom via `margin-top: auto` so the Run button sits in the same place regardless of pane content.

  Short panes (running, stuck, error) center vertically inside the cell so they don't anchor awkwardly to the top of an oversized container. The container also gets a `min-height: 8rem` baseline so the very first pre-run render doesn't open at zero height.

- 16e3a74: Fix `/runs` page-size links rendering raw `<a>` HTML as escaped text.

  The page-size selector in the runs list footer was building anchor tags as plain strings concatenated with `.join(' ')`, then interpolating into a `html\`...\``template tag — which escapes string values. The result was visible literal`<a href="...">25</a>` text instead of clickable links.

  Switched to the same SafeHtml-fragment pattern the agents-list and tools-list pagers already use, so each link is a `html\`...\`` template literal that the renderer treats as trusted markup.

- 77687c5: Three small polish fixes surfaced during v0.19 testing rounds:

  **SSRF error copy is no longer caller-specific.** `assertSafeUrl` originally said `"http-get and http-post only allow requests to public addresses"` — accurate when it shipped, but `agent install` and the notify dispatcher now call it too. Generalized to `"SSRF protection: only public addresses are allowed."` so the message reads correctly from every caller.

  **`secrets rm` and `secrets remove` work as aliases for `secrets delete`.** Both are common muscle-memory choices (`rm` from shell, `remove` from npm). The canonical command stays `delete`; the aliases are commander-level so help text shows `delete|rm <name>` and either token resolves.

  **Deflaked the post-spawn settle test.** `waitForServiceSettle reports stale when the child dies during the settle window` was relying on a 20ms-vs-100ms timing window that lost on slow CI machines (occasional one-fail-out-of-many runs). Replaced the timer-based race with a deterministic `child.once('exit', ...)` await before the settle — verified 5× without a flake.

- Updated dependencies [16e3a74]
- Updated dependencies [77ab55b]
- Updated dependencies [16e3a74]
- Updated dependencies [a7d1bf0]
- Updated dependencies [76411f7]
- Updated dependencies [16e3a74]
- Updated dependencies [16e3a74]
- Updated dependencies [16e3a74]
- Updated dependencies [3d42b6b]
- Updated dependencies [be8ef64]
- Updated dependencies [e0b4d96]
- Updated dependencies [4c8de94]
- Updated dependencies [16e3a74]
- Updated dependencies [16e3a74]
- Updated dependencies [77687c5]
- Updated dependencies [12627d1]
  - @some-useful-agents/core@0.19.0

## 0.18.0

### Minor Changes

- 9b2956c: AI-generated output widget templates.

  New `ai-template` widget type: describe the layout in plain English, Claude generates an HTML template, we sanitize and reuse it for every run. Fields can be referenced via `{{outputs.NAME}}` and the raw output via `{{result}}`; values are HTML-escaped before substitution and the rendered result is run back through the sanitizer at render time (defense-in-depth).

  **Abstracted LLM provider** so Codex/Gemini/etc. can plug in via `registerTemplateGenerator()` without route changes. Ships with Claude (`claudeTemplateGenerator`) by default, spawning the local `claude --print` binary with a strict system prompt.

  **Pure tag/attribute allowlist sanitizer** (`sanitizeHtml`, zero deps). Strips `<script>`, `<iframe>`, `<form>`, `on*` handlers, `javascript:`/`vbscript:` URLs, and non-image `data:` URLs. Preserves SVG with its cased attributes (`viewBox`, `gradientUnits`, etc.) so generators can emit inline charts.

  **UX:** Generate click opens a modal with a spinner, elapsed-seconds counter, and a Cancel button wired through `AbortController` + `req.close` so Claude is actually killed on cancel.

  New exports from core: `sanitizeHtml`, `substitutePlaceholders`, `claudeTemplateGenerator`, `getTemplateGenerator`, `listTemplateGenerators`, `registerTemplateGenerator`.

- 9b2956c: New builtin tool + example agents for data visualization.

  - **`csv-to-chart-json`** builtin — turns CSV (inline or file path) into the JSON shape `modern-graphics-generate-graphic` expects. Three shapes: `simple` (labels + values), `series` (labels + named series), `cohort` (date + size + values). CSV parser handles quoted fields and escaped quotes.
  - **`graphics-creator-mcp`** example agent — topic + audience brief → modern-graphics theme creation → hero render → composite overlay. Demonstrates MCP tool chaining end-to-end.
  - **`chart-creator-mcp`** example agent — CSV input → `csv-to-chart-json` → `modern-graphics-generate-graphic`. Supports all 22 chart layouts via enum dropdown.

- 9b2956c: MCP servers as a first-class entity.

  Tools imported from an MCP server are now grouped under a named server record. The new `mcp_servers` SQLite table plus an additive `mcp_server_id` column on `tools` lets the dashboard manage whole servers at once — enable/disable gates every tool from that server without deleting anything, delete cascades to all its imported tools.

  - New `type: 'mcp'` tool implementation with pooled MCP client (stdio + streamable-HTTP)
  - `/tools/mcp/import` accepts a Claude-Desktop/Cursor `mcpServers` config, a bare map, or a single `{command,args,env}` entry. JSON and YAML. Multi-server paste discovers every entry in parallel and groups the picker by server.
  - `/tools/mcp/import` also has a "Quick add by URL" shortcut for HTTP servers.
  - `/settings/mcp-servers` — table with tool counts, enable/disable toggle, cascade delete.
  - Executor gate: nodes referencing a tool from a disabled server fail with `errorCategory: 'setup'` and a clear "server X is disabled" error.
  - Tool detail page shows the source server with a link back to settings.

  Parser exported from core: `parseMcpServersBlob`, with per-entry errors so a partially-valid blob still yields the servers that _are_ valid.

- 9b2956c: Output Widget editor made self-teaching.

  Replaced the bare widget-type dropdown with a card picker. Each card has a description, ASCII layout sketch, and context-aware helper copy that updates as you switch. Field-type dropdown gains per-type tooltips and dims types that don't apply to the selected widget.

  New **"Load example"** dropdown with 5 starter widgets (Report card, Metric dashboard, File preview, Diff applier, Key-value summary) that populate the form in one click.

  New **live preview card** below the form that rerenders the widget with synthetic sample data on every edit. Backed by a new `POST /agents/:id/output-widget/preview` route — no DB writes — that reuses the existing `renderOutputWidget()` renderer.

  Matching polish on the Pulse "Output Widget" tile explainer so both surfaces use the same vocabulary.

### Patch Changes

- 9b2956c: Dashboard polish bundle.

  - **/tools** now has **User** / **Built-in** tabs with per-tab counts and pagination — replaces the combined grid where builtins filled the first page.
  - **/agents** gets the same treatment: **User** / **Examples** tabs (and a conditional **Community** tab when relevant). Source filter dropdown folded into tabs.
  - **Variables editor** supports `enum` inputs end-to-end: new values column that accepts comma-separated or JSON-array form; enum without values surfaces a clear error instead of silently saving.
  - **Pagination size links** (`12 24 48 100`) rendered correctly on `/tools` — previously HTML-escaped by the tagged template.
  - **Pulse "Output Widget" tile** explainer is now informative: describes the four widget types, how fields map to output, and links to `/agents/<id>/config`.

- Updated dependencies [9b2956c]
- Updated dependencies [9b2956c]
- Updated dependencies [9b2956c]
- Updated dependencies [9b2956c]
- Updated dependencies [9b2956c]
  - @some-useful-agents/core@0.18.0

## 0.17.0

### Minor Changes

- 998e881: Security: SSRF protection on http-get/http-post, auth token moved from URL query param to fragment, CSP + security headers on dashboard, Postgres bound to localhost in Docker Compose.

### Patch Changes

- Updated dependencies [998e881]
  - @some-useful-agents/core@0.17.0

## 0.16.1

### Patch Changes

- Updated dependencies
  - @some-useful-agents/core@0.16.1

## 0.16.0

### Patch Changes

- Updated dependencies
- Updated dependencies [544fb33]
- Updated dependencies
- Updated dependencies [2ca929d]
- Updated dependencies [b94f89b]
- Updated dependencies [4b97cc8]
- Updated dependencies [8b95d36]
- Updated dependencies [48c57f8]
- Updated dependencies [1744a9f]
- Updated dependencies
- Updated dependencies [3fe5c47]
- Updated dependencies [2cb27af]
- Updated dependencies [21cc114]
- Updated dependencies [6c25718]
- Updated dependencies [ffa2986]
  - @some-useful-agents/core@0.16.0

## 0.15.0

### Patch Changes

- @some-useful-agents/core@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [f7c0689]
- Updated dependencies [b7c73aa]
- Updated dependencies [31fd09f]
  - @some-useful-agents/core@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [e8b3079]
- Updated dependencies [0e21b19]
  - @some-useful-agents/core@0.13.0

## 0.12.0

### Patch Changes

- a84193d: **feat: RunStore.queryRuns + shared HTTP auth module.** Foundation for the v0.12.0 dashboard — no user-facing behavior changes yet, but two pieces are now ready for the dashboard to build on:

  ### `RunStore.queryRuns({ filter })`

  Richer run-query API with filter composition, offset pagination, and a total-count return. Supersedes `listRuns` for the dashboard's `/runs` page (and any caller that needs paged output without a second COUNT query):

  ```ts
  const { rows, total } = store.queryRuns({
    agentName: "hello",
    statuses: ["completed", "failed"], // OR within statuses
    triggeredBy: "schedule",
    q: "abc", // prefix on id OR substring on agentName (case-insensitive)
    limit: 50,
    offset: 0,
  });
  ```

  - All filter fields compose with `AND`; `statuses[]` OR's within itself
  - `q` escapes SQL `LIKE` metacharacters so `50%` matches `"50%-win"` literally instead of every row
  - `limit` is clamped to `MAX_RUNS_LIMIT = 500`; `DEFAULT_RUNS_LIMIT = 50`
  - Two new indexes (`idx_runs_triggeredBy`, `idx_runs_startedAt` — DESC for the newest-first default) keep filter + order costs cheap
  - `distinctValues(column)` helper enumerates seen agents / statuses / triggeredBy values for dropdown population; the column name is allowlist-checked so there's no SQL-injection surface from the string

  Existing `listRuns` is untouched — MCP server, CLI `status`/`logs`/`cancel` keep working. Migration to `queryRuns` is opt-in per caller.

  ### Shared HTTP loopback auth (`@some-useful-agents/core/http-auth`)

  The `checkAuthorization`, `checkHost`, `checkOrigin`, and `buildLoopbackAllowlist` helpers that lived in `packages/mcp-server/src/auth.ts` are now in core. Same implementations, same tests (via the existing mcp-server suite). The mcp-server's `auth.ts` is now a thin re-export so existing internal imports keep working unchanged. New `checkCookieToken` sibling for cookie-based auth (the dashboard's case).

  Why: the dashboard needs the same three checks. Having it import from `@some-useful-agents/mcp-server` would couple a human-facing HTML surface to a programmatic-API package for a concern that belongs at the shared layer.

- 689b77a: **feat: `sua dashboard start` — read-only web UI with run-now + runs filter/pagination.** Closes v0.12's scope: a monitoring + nudge surface that complements the CLI without duplicating it.

  ### What ships

  - `sua dashboard start [--port 3000] [--host 127.0.0.1]` boots an Express app that shares the MCP bearer token at `~/.sua/mcp-token` for auth. Prints a one-time sign-in URL; cookie is the token itself, `HttpOnly` + `SameSite=Strict`, 8-hour expiry.
  - **Routes:** `/` redirects to `/agents`; `/agents` lists everything loadable with type/source badges; `/agents/:name` shows resolved YAML, declared inputs, live secrets-status (green/red/"unknown (store locked)" when v2 passphrase-protected), recent runs, run-now button.
  - **`/runs` — runs list with filters and pagination.** Agent dropdown + Triggered-by dropdown + multi-status checkboxes (OR within, AND across) + free-text `?q=` that prefix-matches on run id and substring-matches on agent name (case-insensitive). `?limit=` default 50, max 500. `?offset=` Prev/Next links preserve all filter state through the URL query string.
  - **`/runs/:id` — run detail** with status badge, timing, output frame, error pane. In-progress runs inline a 2-second poll via vanilla JS that swaps the container fragment without a full page reload.
  - **Run-now gate.** Local/examples agents submit directly. Community shell agents show a modal with the command and require an explicit audit checkbox before submit; the server double-checks `confirm_community_shell=yes` on the POST. Provider-level `UntrustedCommunityShellError` still applies — the modal is a UX, not a security, gate.
  - **Defenses** match MCP: `127.0.0.1` bind by default, Host + Origin allowlists (identical to the MCP server's, now shared via `@some-useful-agents/core/http-auth`), cookie-based session, CSRF defense via Origin check.

  ### New types + API

  - `Run.triggeredBy` adds `'dashboard'` to the union.
  - New `DashboardContext` exported from `@some-useful-agents/dashboard` for test harnesses that want to drive `buildDashboardApp(ctx)` via supertest without spinning an HTTP listener.

  ### Dependencies

  Adds `supertest` + `@types/supertest` (dev) to the dashboard package. Runtime deps unchanged — the UI is tagged template literals + inlined CSS/JS, no framework, no bundler, no CDN.

  ### Tests

  `packages/dashboard/src/dashboard.test.ts` — 15 supertest cases covering auth flows (cookie round-trip, Host/Origin rejection, wrong-token 401), filter routing (agent / status OR / unknown-status defense / pagination link preservation), and the run-now gate (community modal refusal without confirm, provider gate still fires with confirm).

  302 tests total across the repo (was 287; +15 new).

  ### Out of scope (deferred)

  - Custom-input form for run-now (YAML defaults only, as in the plan)
  - Editing YAML or setting secrets from the UI
  - Mermaid topology view of agent chains (planned for v0.13 alongside LLM-discoverable docs)

  ### Manual verify

  ```bash
  cd /tmp && mkdir sua-play && cd sua-play
  sua init
  sua agent run hello
  sua dashboard start --port 3000
  # Click the printed auth URL → cookie set → bookmark /
  # Explore /agents, /runs, try the run-now button.
  ```

- Updated dependencies [a84193d]
- Updated dependencies [689b77a]
  - @some-useful-agents/core@0.12.0

## 0.11.0

### Patch Changes

- ad651db: **fix: don't open the secrets store for agents that declare no secrets.**

  v0.10.0 regression: `LocalProvider.submitRun` and `runAgentActivity` both called `secretsStore.getAll()` unconditionally for every run, which meant any agent — even one with no `secrets:` field — needed the store to be unlockable. On a v2 passphrase-protected store that turned every run into "set SUA_SECRETS_PASSPHRASE or nothing works", which was never the intent.

  Now the store is only opened when the agent actually declares secrets. Regression test in `local-provider.test.ts` uses a store that throws on any read and asserts the provider never touches it for an agent with no `secrets:` field.

- Updated dependencies [a21055c]
- Updated dependencies [ad651db]
  - @some-useful-agents/core@0.11.0

## 0.10.0

### Minor Changes

- b855d95: **security: passphrase-based KEK for the secrets store (v0.10.0).** Closes the last finding from the original `/cso` audit. `data/secrets.enc` now encrypts under a key derived from a user passphrase via scrypt (N=2^17, r=8, p=1) with a per-store random salt, instead of the v1 hostname+username seed. A payload-exfil attacker can no longer decrypt the store by guessing trivially-known machine attributes.

  ### What changed

  - New v2 payload format: `{ version: 2, salt, iv, tag, data, kdfParams, obfuscatedFallback? }`. Salt and KDF parameters live alongside the ciphertext so we can tune scrypt upward in future versions without breaking old stores — readers honor whatever the file says.
  - Passphrase prompt on `sua secrets set` against a cold or v1 store. Confirmed twice before write. An empty passphrase explicitly opts into the legacy hostname-derived key and writes `obfuscatedFallback: true` into the payload so every subsequent read loudly warns.
  - New `sua secrets migrate` command: decrypt a v1 or v2-obfuscatedFallback store with the legacy key, re-encrypt under a new passphrase. Atomic via tempfile + rename.
  - `sua doctor --security` reports the store's encryption mode: `v2 passphrase-protected` (green), `v2 obfuscatedFallback` / `legacy v1` (red, points at `sua secrets migrate`).
  - `SUA_SECRETS_PASSPHRASE` environment variable is read by every code path that opens the store — required for CI/non-TTY contexts running scheduled agents against a v2 passphrase-protected store.
  - Legacy v1 payloads still decrypt for reads (with a warning on every load). First write auto-migrates to v2 under whatever passphrase the caller provides; run `sua secrets migrate` to upgrade without having to set a new secret first.

  ### Migration

  If you have an existing v0.9.x install with a `data/secrets.enc` on disk:

  ```bash
  # Option A: explicit migrate
  sua secrets migrate

  # Option B: auto — the next `sua secrets set` or `sua secrets delete` migrates
  sua secrets set ANY_KEY
  ```

  Both routes prompt for a new passphrase (or accept an empty one to stay on the legacy hostname key with an on-by-default warning).

  ### CI / non-TTY

  Set `SUA_SECRETS_PASSPHRASE` in the environment. A non-TTY `sua secrets set` against a cold store without the env var exits 1 with a clear error. If you want to preserve the pre-v0.10 zero-friction behavior, set `SUA_SECRETS_PASSPHRASE=` (explicit empty string) — this is treated as "use the legacy hostname-derived key" and is labeled as such in both the payload and in `sua doctor --security`.

  ### Rejected alternatives

  - **`keytar` / OS keychain** — native dependency that breaks `npx` on fresh machines (libsecret missing on Linux, Rosetta issues on M-series Macs). We may revisit with a pure-JS implementation later; for now, passphrase with empty-fallback covers the threat model without native bindings.
  - **Auto-derived "machine key" from additional attributes** — still guessable for a targeted attacker. Passphrase is the honest primitive.

  ### Not in this release

  - `sua secrets rotate-passphrase` — planned for v0.11 or later.
  - Keyfile-as-alternative-to-env-var (`SUA_SECRETS_KEYFILE`) — planned for v0.11 or later.
  - Dashboard badge for store encryption mode — v0.11.0 consumes the state surfaced by this release.

### Patch Changes

- Updated dependencies [b855d95]
  - @some-useful-agents/core@0.10.0

## 0.9.0

### Minor Changes

- b80d772: **feat: typed runtime inputs for agents.** Callers can now supply named, typed values at invocation time and agents substitute them into prompts or read them as environment variables. Closes the "I want my agent to take a parameter" story.

  ### Declare once, use everywhere

  ```yaml
  name: weather-verse
  type: claude-code
  prompt: "Weather for zip {{inputs.ZIP}} as a {{inputs.STYLE}}."
  inputs:
    ZIP:
      type: number
      required: true
    STYLE:
      type: enum
      values: [haiku, verse, limerick]
      default: haiku
  ```

  ```bash
  sua agent run weather-verse --input ZIP=94110
  sua agent run weather-verse --input ZIP=10001 --input STYLE=limerick
  ```

  ### Two execution models, one declaration

  - **claude-code agents** — `{{inputs.X}}` in the prompt (and in `env:` values) is substituted before spawn. Claude reads the resolved text; no injection class because prompts aren't executed.
  - **shell agents** — declared inputs become env vars. Authors write `"$ZIP"` in their commands; bash handles quoting. `{{inputs.X}}` inside a shell `command:` is rejected at load time with a clear error pointing to the `$X` form.

  ### Types

  | `type`    | Accepts                                           | Notes                           |
  | --------- | ------------------------------------------------- | ------------------------------- |
  | `string`  | any string                                        | default if unspecified          |
  | `number`  | `Number(x)` must be finite; empty string rejected | renders as decimal string       |
  | `boolean` | `true/false/1/0/yes/no` (case-insensitive)        | renders as `"true"` / `"false"` |
  | `enum`    | values listed in the spec's `values` array        | must declare `values`           |

  Type is for _validation at the boundary_, not downstream coercion. Every resolved input renders as a string — `{{inputs.VERBOSE}}` with `VERBOSE=true` substitutes the literal text `"true"`.

  ### Precedence (highest wins)

  1. `sua agent run --input K=V` (per-invocation)
  2. `sua schedule start --input K=V` (daemon-wide override, applies to every fired run; agents that don't declare the input ignore it)
  3. YAML `default:` (per-agent)
  4. Else fail loudly (`MissingInputError`, `InvalidInputTypeError`, `UndeclaredInputError`)

  ### Load-time checks

  - `inputs:` names must be `UPPERCASE_WITH_UNDERSCORES` (env-var convention)
  - `type: enum` must declare a non-empty `values:` array
  - Every `{{inputs.X}}` in prompt or `env:` values must appear in the `inputs:` block (typos caught before execution)
  - Shell `command:` cannot contain `{{inputs.X}}` — use `$X` instead

  ### Run-time checks

  Ordered: undeclared provided key → invalid type → missing required. All fail before spawn, recorded as a failed run in history.

  ### New exports from `@some-useful-agents/core`

  - `AgentInputSpec` type
  - `inputSpecSchema` — zod schema
  - `resolveInputs(specs, provided, options?)` — returns resolved string map or throws
  - `validateAndRender(name, spec, raw)` — single-value validator
  - `extractInputReferences(text)` — returns set of `{{inputs.X}}` names
  - `substituteInputs(text, resolved)` — applies the map to a string
  - `MissingInputError`, `InvalidInputTypeError`, `UndeclaredInputError`
  - `RunRequest` — formalized `submitRun` request shape with optional `inputs`

  ### API changes (library consumers)

  - `Provider.submitRun(request: RunRequest)` — request type now has `inputs?: Record<string, string>`.
  - `ExecutionOptions.inputs?: Record<string, string>` on `executeAgent`.
  - `ChainOptions.inputs?: Record<string, string>` on `executeChain` — flows to every agent in the chain.
  - `LocalSchedulerOptions.inputs?: Record<string, string>` — daemon-wide overrides applied to every fired run.
  - Temporal activities/workflows carry `inputs` in their payload so workers on other hosts inherit the caller's input values.

  ### Docs

  - README commands table and full-fat YAML example updated to show `inputs:` and `--input`.
  - ROADMAP lists v0.9.0 under "Now".
  - `sua agent audit` prints declared inputs with types, defaults, required flags, and descriptions.

### Patch Changes

- Updated dependencies [b80d772]
  - @some-useful-agents/core@0.9.0

## 0.8.0

### Minor Changes

- a171b77: **feat(cli): visual polish pass across every command.** One voice, one look. No behavior changes, no API changes.

  ### What shipped

  - **New `packages/cli/src/ui.ts`** — shared helpers (`ui.ok`, `ui.fail`, `ui.warn`, `ui.info`, `ui.step`, `ui.section`, `ui.banner`, `ui.outputFrame`, `ui.kv`, inline helpers `ui.agent`/`ui.cmd`/`ui.dim`/`ui.id`). Every command now routes its status lines through these helpers instead of reaching for `chalk.green/red/yellow` directly.
  - **Unified emoji symbol set** — ✅ success, ❌ failure, ⚠️ warning, 💡 info, 🚀 next-step. Tutorial's 🎭 dad-joke flourish preserved. Output looks the same whether you run `sua init`, `sua doctor --security`, or `sua agent new`.
  - **Boxed daemon banners** — `sua mcp start`, `sua schedule start`, and `sua worker start` now print a `boxen` banner with the config details instead of loose dim-text lines. Adds one new dep (`boxen@^8`, ~8KB, no surprises).
  - **Custom top-level `sua --help`** — now includes an Examples block and pointers to `docs/SECURITY.md` + the repo. `showHelpAfterError(true)` so unknown commands print help automatically.
  - **Unified output frame** — `sua agent run` and `sua agent logs` both wrap captured stdout in `╭── output ──╮ / ╰────────────╯` (was duplicated ad-hoc dim dashes in both files).
  - **`sua agent audit` key/value rows** go through `ui.kv()` instead of a command-local `row()` helper.
  - **`STATUS_COLORS` centralized** — moved from `commands/status.ts` to `ui.ts` so `status`, `schedule`, and future surfaces agree on what color a `running` / `pending` / `failed` run is.

  ### Files touched

  **New:**

  - `packages/cli/src/ui.ts`
  - `packages/cli/src/ui.test.ts` — 20 tests, pure stdout capture, covers every helper.

  **Modified (every command):**

  - `packages/cli/package.json` — add `boxen` dep
  - `packages/cli/src/index.ts` — Examples block + `showHelpAfterError`
  - All 13 command files: `init.ts`, `list.ts`, `status.ts`, `run.ts`, `cancel.ts`, `logs.ts`, `mcp.ts`, `schedule.ts`, `worker.ts`, `secrets.ts`, `doctor.ts`, `audit.ts`, `new.ts`, `tutorial.ts`

  ### Tests

  196 total (was 176; +20 new in `ui.test.ts`). Zero existing tests changed — the polish doesn't alter any assertable behavior. Lint + build clean.

  ### User-visible diffs

  - Every success line is now `✅  Created foo.yaml` instead of green-only `Created foo.yaml`.
  - Every error line is `❌  Agent "foo" not found.` instead of `Error: Agent ...` / bare red.
  - Every warning is `⚠️  ...` instead of `Warning: ...`.
  - `sua mcp start` / `sua schedule start` / `sua worker start` print a cyan-bordered banner with host/port/paths.
  - `sua --help` ends with an Examples block.
  - Run output is framed in a unicode box.

  If you were grepping command output in scripts (you shouldn't be), those strings changed. No machine-readable output was altered (JSON / tables / exit codes are all identical).

  ### Non-goals

  Deferred — not in this PR:

  - Switching `readline/promises` → `@inquirer/prompts` for `sua agent new` / `sua tutorial` (UX shift, separate design pass).
  - Timing info on `sua agent run` (`"completed in 2.3s"`).
  - Progress bars for long chains.
  - Themeable colors via config.

### Patch Changes

- Updated dependencies [a171b77]
  - @some-useful-agents/core@0.8.0

## 0.7.0

### Minor Changes

- 51155a4: **feat: `sua agent new` — interactive agent scaffolder.** Graduates users from "I ran an example" to "I authored an agent" without hand-writing YAML. Closes the _Interactive agent creator_ roadmap item.

  ### What it does

  `sua agent new` walks through a short prompt flow:

  1. **Type** — shell or claude-code (default shell)
  2. **Name** — validated against `[a-z0-9-]+` at prompt time
  3. **Description** — optional one-liner
  4. **Command** (shell) or **Prompt + Model** (claude-code)
  5. **Customize more?** — gate to the advanced fields
     - Timeout (default 300s)
     - Cron schedule (5-field; the v0.4.0 frequency cap still applies)
     - Secrets (comma-separated uppercase names; invalid ones are ignored with a warning)
     - `mcp: true` opt-in for Claude Desktop exposure
     - `redactSecrets: true` for known-prefix scrubbing of output
  6. **Preview + confirm** — prints the resolved YAML, asks before writing
  7. **Write** — lands in `agents/local/<name>.yaml`, chmod-safe, overwrite-guarded

  Every emitted YAML is validated against `agentDefinitionSchema` _before_ the file is written — if validation fails (shouldn't, given the prompt guards), the command exits 1 without side effects.

  ### Why now

  The security PRs (v0.4.0 → v0.6.1) added fields to the schema that are easy to forget by hand: `mcp`, `allowHighFrequency`, `redactSecrets`. Having the creator land _after_ those PRs means the prompt flow covers the full schema from day one, rather than being retrofitted.

  ### Implementation notes

  - Pure `buildAgentYaml(answers)` function is exported for testing — given an answers object, it emits deterministic, validated YAML with a stable key order (identity → type → execution → scheduling → capabilities).
  - Interactive flow uses `node:readline/promises`, matching the pattern already in `sua tutorial`. No new prompt-library dependency.
  - The command is read-only until the user confirms at the very end, so Ctrl-C at any stage leaves the filesystem untouched.

  ### Tests

  14 new tests in `packages/cli/src/commands/new.test.ts`:

  - YAML round-trips through `yaml.parse` to the expected object (shell + claude-code minimums).
  - Key order is semantic and stable.
  - Optional fields are omitted when not set; `mcp: false` / `redactSecrets: false` don't clutter the output.
  - Shell and claude-code fields don't leak into each other.
  - Every emitted YAML parses AND validates through `agentDefinitionSchema` (parameterized across several answer shapes).
  - Schedules emitted by the creator pass the v0.4.0 cron frequency cap.

  176 total tests pass.

  ### Follow-up (not in this PR)

  The tutorial's "now make your own" stage-6 wrapper — the thing that invokes this verb from inside `sua tutorial` — stays on the roadmap. It's a guided wrapper around this verb, not a new capability; making `sua agent new` a first-class verb means it's reusable outside the tutorial too.

### Patch Changes

- Updated dependencies [51155a4]
  - @some-useful-agents/core@0.7.0

## 0.6.1

### Patch Changes

- 9875ca4: **Fix: community agents are now runnable from the CLI so the v0.6.0 shell gate is actually reachable.** Before this patch, `sua agent run <name>` and `sua schedule start` only loaded `agents/examples/` + `agents/local/` — community agents were visible via `sua agent list --catalog` but "not found" at run time. The shell gate in `executeAgent` was effectively dead code for the primary CLI flow (it still fired for Temporal activities and `executeChain`, both tested).

  Now the runtime commands load from `dirs.all` (runnable + catalog) and the shell gate enforces per-agent opt-in via `--allow-untrusted-shell <name>` exactly as the v0.6.0 docs promised.

  ### Behavior changes

  - `sua agent run <community-agent>` is now accepted at lookup time and refuses at execute time with the expected `UntrustedCommunityShellError` message. Opt in with `--allow-untrusted-shell <name>`.
  - `sua schedule start` will now fire community agents that have a `schedule:` field; the gate still refuses unaudited community shell.
  - `sua mcp start` exposes community agents that have `mcp: true` in their YAML (still filtered by the opt-in flag — no behavior change for agents without it).
  - `sua doctor --security` now counts community shell agents whether or not they've been copied into `agents/local/`.
  - `sua secrets check <name>` now works on community agents.

  ### Unchanged by design

  - `sua agent list` still defaults to `runnable` vs `--catalog` so users can tell their own agents apart from third-party catalog entries.
  - `sua agent audit <name>` already loaded both; unchanged.

  ### Docs

  - `docs/SECURITY.md` and `README` version labels updated from the aspirational `v0.5.1` (what the plan predicted) to `v0.6.0` (what actually shipped). Future passphrase-KEK work renumbered to `v0.7.0`.
  - Version history in SECURITY.md gets a new `v0.6.1` entry documenting the gate wiring fix.

  No API changes. No migration needed.

- Updated dependencies [9875ca4]
  - @some-useful-agents/core@0.6.1

## 0.6.0

### Minor Changes

- d86595f: **Security: community shell agent gate + run-store hygiene + auditing surfaces.** Closes `/cso` findings #5 (shell sandbox — short-term gate) and #7 (run-store hygiene). Third and final wave of the security remediation plan before v0.6.0's passphrase-based secrets KEK.

  ### Behavior changes

  - **Community shell agents refuse to run by default.** `executeAgent` throws `UntrustedCommunityShellError` when an agent with `type: shell` and `source: community` reaches the executor without explicit opt-in. Opt in per-agent (not global) via the new `--allow-untrusted-shell <name>` flag on `sua agent run` and `sua schedule start`. The error message tells the user exactly how to proceed: audit the command, then re-run with the flag. The refusal is recorded in the run store as a failed run so it shows up in history.
  - **Run-store is locked down.** `data/runs.db` is `chmod 0o600` at create time. A startup sweep deletes rows older than `runRetentionDays` (default 30; configure in `sua.config.json` or via the `retentionDays` option on `RunStore`). `Infinity` disables the sweep.
  - **Opt-in secret redaction.** A new `redactSecrets: true` agent YAML field runs captured stdout/stderr through a known-prefix scrubber before the store records it. Targets AWS access key IDs (`AKIA…`), GitHub PATs (`ghp_…`), OpenAI / Anthropic keys (`sk-…` / `sk-ant-…` / `sk-proj-…`), and Slack tokens (`xoxb-`, `xoxp-`, `xapp-`). Intentionally narrow to avoid the false positives that kill generic "value > 20 chars" scrubbers.

  ### New CLI surfaces

  - **`sua agent audit <name>`** — read-only. Prints the resolved YAML with type, source, schedule, `mcp:`, `redactSecrets:`, secrets, envAllowlist, env, dependsOn, and the full `command:` or `prompt:`. Community agents get a loud warning footer explaining the `--allow-untrusted-shell` gate.
  - **`sua doctor --security`** — read-only. Checks chmod 0o600 on the MCP token, secrets store, and run-store DB; confirms the MCP bind host; lists community shell agents that would refuse to run; shows which agents are MCP-exposed. Non-zero exit when any check fails.

  ### API changes (for library consumers)

  - `executeAgent(agent, env, options?)` — new third argument `{ allowUntrustedShell?: ReadonlySet<string> }`. Community shell throws `UntrustedCommunityShellError` when the agent name is not in the set.
  - `LocalProvider` now accepts an options object as its third constructor arg: `{ allowUntrustedShell?, retentionDays? }`. The old two-arg form still works.
  - `TemporalProvider` accepts the same two options and propagates `allowUntrustedShell` through the workflow input so workers inherit the submitter's trust decision.
  - `RunStore` accepts a `{ retentionDays?: number }` options argument. Exposes `sweepExpired(days)` for manual invocation.
  - New exports from `@some-useful-agents/core`: `UntrustedCommunityShellError`, `ExecutionOptions`, `LocalProviderOptions`, `RunStoreOptions`, `DEFAULT_RETENTION_DAYS`, `redactKnownSecrets`.
  - New CLI helper: `createProvider(config, { providerOverride?, allowUntrustedShell? })`. The previous bare-string signature still works.

  ### Migration

  If you write shell agents under `agents/community/`, they will now refuse to run unless the caller passes `--allow-untrusted-shell <name>`. Either move the agent to `agents/local/` (treated as trusted) or audit and opt in per-invocation. Run `sua doctor --security` to see which agents are affected.

  If you want known-prefix redaction for an agent's output, add `redactSecrets: true` to its YAML. Default behavior is unchanged — existing agents keep storing output verbatim.

  `data/runs.db` will now be chmod 0600 and the startup sweep will delete rows older than 30 days. To change the window, add `"runRetentionDays": N` to `sua.config.json`; set it very large to effectively disable.

  Docs: `docs/SECURITY.md` and the README security notes are updated to reflect what shipped vs what remains on the roadmap.

### Patch Changes

- Updated dependencies [d86595f]
  - @some-useful-agents/core@0.6.0

## 0.5.0

### Minor Changes

- 3218194: **Security: chain trust propagation + MCP agent opt-in + threat model docs.** Closes `/cso` finding #4 and the MCP-scope portion of the remediation plan. Two behavior changes, one new default, and a new public doc.

  ### Behavior changes

  - **MCP agents must opt in to be callable.** Only agents with `mcp: true` in their YAML are exposed via the MCP server's `list-agents` and `run-agent` tools. Non-exposed agents respond as "not found" so a compromised client cannot enumerate your full catalog. Existing example YAMLs (`hello-shell`, `hello-claude`, `dad-joke`) ship with `mcp: true` so the tutorial keeps working; new agents scaffolded by `sua init` default to `mcp: false` with a commented hint.
  - **Community agent output flowing through chains is now treated as untrusted.**
    - Claude-code downstream prompts that consume `{{outputs.X.result}}` from a community-sourced X get a `[SECURITY NOTE]` prepended and the value wrapped in `BEGIN/END UNTRUSTED INPUT FROM X (source=community)` delimiters.
    - Shell downstream of a community upstream is **refused outright** with `UntrustedShellChainError`. This blocks the most direct RCE path (community output landing in a shell env var that a careless command could eval). Override via `executeChain`'s new `allowUntrustedShell: Set<agent-name>` option — per-agent, not global.
    - All chains, trusted or not, now receive `SUA_CHAIN_INPUT_TRUST=trusted|untrusted` in the downstream env so shell agents can branch.

  ### New documentation

  - **`docs/SECURITY.md`** — full threat model: intended use, trust rings, layered MCP defenses, chain trust propagation, env filtering, cron cap, supply-chain posture. Equally explicit about what sua does NOT defend against (shell sandbox, secrets-store encryption strength, run-output secrets, Temporal history, remote MCP, DoS) so operators can evaluate fit without reading the code.
  - **README** gains a four-sentence threat-model banner above the Quick start section, and the existing "Security notes" list is rewritten to reflect current reality.

  ### API changes (worth calling out for library consumers)

  - `ChainOutput` (new exported type) — the outputs map value is now `{ result, exitCode, source }`. The resolver uses `source` to decide whether to wrap.
  - `resolveTemplateTagged(template, outputs)` (new) — returns `{ text, upstreamSources: Set<AgentSource> }`.
  - `executeChain(agents, provider, triggeredBy, options)` — fourth argument is now an options object `{ allowUntrustedShell?, pollInterval? }`. The previous positional `pollInterval` signature is replaced. No internal callers exist so this is a clean break; adjust any direct consumers.
  - `UntrustedShellChainError` (new exported error) — thrown before the run starts.

  ### Migration

  If you author YAML agents: add `mcp: true` to any agent you want reachable from Claude Desktop or another MCP client. The CLI commands (`sua agent run`, `sua schedule start`, etc.) are unaffected.

  If you consume `@some-useful-agents/core` as a library: `executeChain`'s fourth arg became an options object, and the outputs map carries `source`. If you were passing a bare number for poll interval, wrap it as `{ pollInterval: n }`.

### Patch Changes

- Updated dependencies [3218194]
  - @some-useful-agents/core@0.5.0

## 0.4.0

### Minor Changes

- dae7022: **Security: transport lockdown.** Closes findings #1, #3, #6, and #8 from the `/cso` audit. This is the first wave of security hardening that lands before the broader community-trial push. Three behavior changes worth noting up front, plus several invisible defenses.

  ### Behavior changes

  - **MCP server now binds to `127.0.0.1` by default.** Previously it bound to all interfaces (Node's default for `listen(port)` with no host), so anyone on the same Wi-Fi could POST to the MCP endpoint and execute any loaded agent with the user's secrets. The console log used to lie about this — it claimed `localhost` while binding everywhere. New `--host` flag on `sua mcp start` for users who genuinely need LAN exposure (prints a warning).
  - **MCP server now requires a bearer token** (`Authorization: Bearer <token>`). `sua init` and `sua mcp start` create a 32-byte token at `~/.sua/mcp-token` (mode 0600) on first run. Existing MCP clients (Claude Desktop, etc.) need to be updated with the new header — `sua mcp start` prints a ready-to-paste config snippet. Use `sua mcp rotate-token` to roll the token; `sua mcp token` prints the current value.
  - **Cron schedules now have a 60-second minimum interval.** node-cron silently accepted 6-field "with-seconds" expressions like `* * * * * *` (every second), which could melt an Anthropic bill. 5-field expressions (the standard) still pass unchanged. The new `allowHighFrequency: true` YAML field bypasses the cap with a loud warning logged on every fire.

  ### Invisible hardening

  - MCP server checks the `Host` header against a loopback allowlist (defense for the `--host` case).
  - MCP server checks the `Origin` header against the same allowlist (defends against DNS rebinding from a browser tab).
  - Each MCP session is pinned to the sha256 of the bearer token used to create it, so `rotate-token` cannot be abused to hijack live sessions.
  - Bearer comparison uses `crypto.timingSafeEqual` to avoid timing leaks.
  - `actions/checkout`, `actions/setup-node`, and `changesets/action` are now SHA-pinned in CI workflows so a compromise of those orgs can't silently ship malicious code through a moving tag. Dependabot opens weekly PRs to refresh the SHAs.
  - New `.github/CODEOWNERS` requires owner review for any change under `.github/workflows/` once the matching ruleset is enabled on `main`.

  ### Migration

  If you are using the MCP server today: after upgrading, run `sua mcp start` once to see the printed config snippet, paste the new `Authorization` header into your client config (Claude Desktop, etc.), and restart your client. If you have YAML agents with 6-field cron schedules, either move them to a 5-field schedule (recommended) or add `allowHighFrequency: true`.

  Audit report and full threat model: see the project's `/cso` workflow.

### Patch Changes

- Updated dependencies [dae7022]
  - @some-useful-agents/core@0.4.0

## 0.3.2

### Patch Changes

- @some-useful-agents/core@0.3.2

## 0.3.1

### Patch Changes

- @some-useful-agents/core@0.3.1

## 0.3.0

### Minor Changes

- 89fd40d: Onboarding walkthrough and local cron scheduler.

  - `sua tutorial`: 5-stage interactive walkthrough that ends with a real scheduled dad-joke agent. Type `explain` at any stage for a Claude or Codex deep-dive.
  - `sua init`: now scaffolds `agents/local/hello.yaml` so `sua agent list` is never empty on first run.
  - `sua schedule start|list|validate`: cron-based scheduler via `node-cron`. Agents with a `schedule` field now actually fire.
  - `sua doctor`: new checks for scheduler readiness, installed LLM CLIs, and scheduled agent validity.
  - New core modules: `LocalScheduler` and `invokeLlm` / `detectLlms` utilities.
  - `dad-joke` example agent in `agents/examples/`.
  - Public `ROADMAP.md` at the repo root.

### Patch Changes

- Updated dependencies [89fd40d]
  - @some-useful-agents/core@0.3.0

## 0.2.0

### Minor Changes

- 3122f3f: Initial public release. Local-first agent playground with YAML agent definitions, CLI (`sua`), MCP server (HTTP/SSE), Temporal provider for durable execution, encrypted secrets store, and env filtering to prevent secret leakage to community agents.

### Patch Changes

- Updated dependencies [3122f3f]
  - @some-useful-agents/core@0.2.0
