# @some-useful-agents/core

## 0.25.0

### Minor Changes

- 5b2d822: Apple integration: dashboard "macOS access" panel — check status + authorize from a Terminal.

  The Apple tab now shows a macOS-access card with per-bucket status (Reminders /
  Notes), a **Check access** button that probes both TCC buckets with zero-content
  reads, and an **Open Terminal & authorize** button that launches a Terminal
  running `sua apple authorize` (so the permission prompts appear in a foreground
  GUI session). The panel and docs explain the TCC + daemon gotcha: macOS ties the
  Reminders grant to the granting process tree, so a detached daemon (and the
  temporal worker that runs agent nodes) can show denied even after you authorized
  in a Terminal — run agents from a Terminal with `SUA_PROVIDER=local`, or start the
  worker in a foreground Terminal.

- 4f69867: Add `sua apple connect` to register the Apple integration from a granted Terminal.

  The dashboard "Add Apple integration" flow introspects via the background daemon,
  which usually lacks Reminders access (macOS ties the grant to the granting process
  tree). `sua apple connect` runs the `lists` introspection in the user's own
  Terminal — where `sua apple authorize` granted access — then upserts the `apple`
  integration (default id `apple`) with the discovered lists/folders, so the
  generated tools become available. Pairs with running agents via
  `SUA_PROVIDER=local` from the same Terminal.

- 64a42dd: Fix intermittent "tool did not resolve" for integration agents run from the inbox.

  Two related fixes for running integration-backed agents (Apple Reminders/Notes,
  and any csv/sqlite/postgres agent) from inbox action cards:

  1. **Run-scoped experimental gate.** Apple-tool availability was gated on the
     worker process's `SUA_EXPERIMENTAL_APPLE` env, which varied by launch path —
     so a worker that didn't inherit it would fail with "tool did not resolve."
     The flag is now read once in the (reliable) dashboard process and threaded
     through the run (`SubmitDagRunOptions` → the Temporal activity → the executor
     gate), so resolution is identical wherever the run lands. The env remains a
     fallback for local/CLI runs.

  2. **Inbox cards run integration agents on the worker.** Inbox action dispatch
     orchestrated in-dashboard without an integrations store, so integration tools
     never resolved there (and the Apple runner needs the worker's macOS grants).
     Inbox-card runs of DAG agents now go through `submitDagRun` — the whole DAG
     executes on the Temporal worker, exactly like the dashboard's "Run now" — and
     the card status + triage follow-up are driven off the run's terminal state.
     Local-backend runs execute in-process with the integration/tool/agent stores.

- 71b5c69: Apple Notes: add a note-update tool to edit an existing note.

  The Apple integration now exposes `apple.apple.note-update` (a sixth generated
  verb): find a note by its current title and replace its body, optionally
  retitling it. Backed by a new `cmdNoteUpdate` in the embedded Swift runner
  (AppleScript; matches by name, signals not-found cleanly). Notes have no stable
  id, so editing targets the title. Pairs with local edit-a-note / list-notes
  agents (read the body, merge, update) for inbox-driven note editing.

- d35a509: Add an owner-authorized Apple Reminders & Notes integration (experimental, macOS-only, default off).

  A new `apple` integration kind lets agents create/read reminders and create/read
  notes on the owner's Mac. It compiles a tiny Swift runner on demand (EventKit for
  Reminders, AppleScript for Notes) — the same compile-on-demand pattern as the
  Apple Foundation Models provider. Saving the integration in the dashboard
  generates `apple.<slug>.reminder-create` / `reminder-read` / `reminder-update` /
  `note-create` / `note-read` tools.

  The engine ships dormant: the `apple` kind, its tools, and the dashboard tab stay
  hidden until the owner enables `experimental.apple` in `sua.config.json` (or sets
  `SUA_EXPERIMENTAL_APPLE=1`). A new `sua apple authorize` command triggers the macOS
  permission prompts from a foreground Terminal so the first grant isn't swallowed by
  a headless daemon. Notes is best-effort (no first-party API). Off macOS the tools
  fail with a clear macOS-only error.

- cbbb346: Inbox triage can now WRITE to dashboards.

  A new `dashboard-editor` action lets the triage agent pin an agent's signal tile
  onto a user dashboard (creating the dashboard if it doesn't exist) or create an
  empty dashboard — e.g. "add the weather agent to my dashboard", "make a dashboard
  called Markets". It's route-handled and auto-approved like `agent-editor`, writes
  synchronously, and is sequenced as one write per turn. Agents without a Pulse
  signal are refused with a clear message (dashboards render signal tiles only).
  Shared slug + section-layout helpers moved into core.

- b2abd8d: Dashboard start: clearer "already running" message + reclaim a stale instance.

  When a dashboard is already bound to the port, `sua dashboard start` now probes
  its `/health` build stamp and tells you the pid, commit, and build time — and
  flags when the running instance is an OLDER build than the one you're starting
  (the "I deployed but still see old code" trap). On a TTY it offers to stop that
  process and take over; a new `--replace` flag does the same non-interactively.
  A foreign (non-dashboard) process on the port is never killed.

  The daemon now starts the dashboard with `--replace`, so a leftover hand-started
  dashboard is reclaimed on restart instead of silently leaving stale code serving.

- 0fc9193: Tighten the inbox detail modal header.

  The thread-action row (Summarize / Move to / Fork / Retarget) is gone. Rare verbs now
  live behind a single overflow (⋯) menu in the title row: Summarize and Reopen (terminal
  threads only). The two confusing cross-agent controls are removed from the human UI —
  "Fork" handed the thread off to another agent as a new thread, and "Retarget" re-pointed
  this thread's agent; both routes remain for the build/diagnose loop, but neither is
  surfaced. Tags now share the meta band instead of taking their own row, and "Open page"
  is clarified to "Open full page". The header collapses from four stacked bands to two.

- 4975d63: Inbox: summon an agent's latest output widget into a thread (mechanism).

  First slice of "widgets in threads". Adds a `show-widget` action mode: instead of running an
  agent, it renders that agent's LATEST COMPLETED run's output widget inline in the conversation
  (read-only, no dispatch). New `InboxActionMeta.mode` field; `parseProposedActions` accepts
  `type: 'show-widget'`; a `resolveShowWidgetAction` resolver points the action at the latest
  completed run and auto-resolves `proposed → completed` (the existing inline-widget render path
  then displays it), or fails clearly ("no completed run yet — run it first"). The card drops the
  run chrome (duration, badge, raw preview) and reads "Latest <agent> output". Guarded against the
  dedup-block and refire-loop edge cases. Dormant until the triage kernel teaches it (next slice).

- 4c5c55e: Unify the dashboard front door: one Mission Control home.

  The root `/` was a stripped-down Pulse (system stat tiles only) duplicating
  `/pulse`, while the inbox — the most powerful surface — was a quiet nav link with
  no presence. There's now ONE dashboard surface at `/`: a "Needs you" strip of
  inbox threads awaiting your reply on top, the live, fully-editable Pulse board
  (system + agent signal tiles, with the dashboards dropdown to switch to named
  dashboards) in the middle, and a collapsed recent-activity feed at the bottom.
  `/pulse` 302-redirects to `/` (its sub-routes — tile fragments, hide/show-all,
  layout planner — are unchanged); the nav renames **Pulse → Home**. A global
  Inbox badge (count from the new `/inbox/needs-you-count`) shows on every page.
  New core inbox queries `countNeedsYou` / `listNeedsYou` back the badge and
  preview.

- b3700cd: Inbox: editing a failed agent unblocks retrying it from the thread.

  The thread-level "same action already failed here" guard (hasMatchingFailedAction)
  keyed only on agent id + inputs, so once an action failed it was blocked forever —
  and for an agent that takes no inputs, every re-proposal looked identical, leaving
  "revise the inputs or choose a different next step" impossible to follow even after
  the operator fixed the agent.

  The guard now clears once the target agent was edited after the failure: it
  compares the agent's `updatedAt` against the failed action's end time, so fixing
  the agent (a new version or a metadata edit, both bump `updatedAt`) makes the retry
  a legitimately new action. Exposes `Agent.updatedAt` from the store, and the triage
  kernel now tells triage to re-propose a run when the operator says they fixed the
  agent.

- c37dfd4: Inbox triage: reach the agent you mean, even with many installed.

  The triage AGENT_CATALOG used to be just the 40 newest agents by creation date, so an agent the
  operator named — but which was old and beyond the cap — was invisible to triage (it couldn't be
  targeted or summoned). The catalog is now selected by blending relevance to the operator's current
  request (keyword match on id/name/tags/description) + recency-of-use (a new
  `RunStore.latestRunAtByAgent()` aggregate) + a reserve of newest-created agents, capped at 40.
  Named/used agents reliably surface; the kernel now compares createdAt across entries for "newest"
  (not list position) and falls back to agent-catalog-search (full catalog) when an agent is elided.

- ebedefd: Triage can now resolve relative times into concrete due dates.

  The inbox triage agent gets the operator's current wall-clock time as a new
  `NOW` input (ISO 8601 with the local UTC offset). The prompt instructs it to
  turn relative phrasing — "before 4:30pm today", "tomorrow 9am", "in 2 hours" —
  into an absolute ISO 8601 timestamp it can hand to an agent that takes a due
  date (e.g. a reminder's `DUE_DATE`), instead of passing a vague phrase or
  guessing the date. Pairs with reminder agents that expose a due-date input.

- 385a892: Inbox triage failure-path hardening.

  Two fixes so a failure no longer leaves the operator stuck or chasing dead links:

  - **Transient triage crashes auto-retry instead of stranding the thread.** A
    crashed triage run (provider hiccup, worker dispatch race, network) now
    retries once with a short backoff before posting a terminal note, and the
    thread is always left `awaiting_user` so it stays actionable. A fresh reply
    or "ask triage" refreshes the retry budget.
  - **Run-failure inbox alerts only mention Temporal when there's a real workflow.**
    The note always links the `/runs/<id>` page; it now offers a Temporal UI deep
    link (and the "ran on Temporal" wording) only when the run reached a durable
    workflow (`temporalRunId` set). Setup failures that never dispatched a
    workflow no longer send the operator hunting for a `sua-node-…` execution
    that was never created.

- 830744d: De-monolith the inbox triage prompt: shared kernel + per-source playbooks.

  The triage agent's prompt had grown to one ~550-line block mixing shared
  mechanics (voice, action-proposal rules, the `<plan>` output schema) with
  source-specific "what to recommend" guidance, so unrelated concerns shared one
  prompt and interfered. The prompt is now composed at run time from fragments on
  disk: a single `kernel.md` (the shared mechanics, one source of truth coupled to
  the route's `<plan>` parser) plus the one `playbooks/<source>.md` that matches
  the thread's source (run-failure / permission-request / cadence / manual),
  selected deterministically from the known `source` field — no classifier LLM and
  still one model call per turn. A thread now only sees its own source's guidance.
  Behavior is preserved; this makes triage far easier to maintain and extend (add
  or refine a source = edit one small file).

- 23ec105: Triage learnings: extractor + resolve trigger + approval UX (flag-gated).

  Second slice of cross-thread triage learnings (experimental). Adds the
  `inbox-learning-extractor` system agent and wires the loop end-to-end:

  - A new **Mark resolved** affordance + `POST /inbox/:id/resolve` route (finally
    wiring up the long-dormant `resolved` status). On resolve, `maybeExtractLearning`
    runs the extractor (gated cheapest-first: flag off → no-op; only run-failure /
    permission-request threads with real triage activity reach the one LLM call) to
    distill at most one durable lesson, stored as a `pending` learning.
  - The thread modal renders a **"Triage learned something"** card with Approve /
    Discard; `POST /inbox/:id/learnings/:lid/(approve|reject)` routes decide it.
    Approved lessons become retrievable; rejected ones are dead.

  Still dormant unless `SUA_EXPERIMENTAL_TRIAGE_LEARNINGS` is set, and learnings are
  not yet injected into the triage prompt (that lands in the final slice).

- 5164ba4: Triage learnings: consult approved lessons in the triage prompt (final slice).

  Flips cross-thread triage learnings from "stored" to "consulted". When a thread
  is triaged, approved lessons relevant to it (matched by agentId + source) are
  retrieved and injected as a numbered `RELEVANT_LEARNINGS` block in the triage
  prompt, with a new kernel section that frames them as advisory priors — they
  inform the recommendation but never authorize an action, and the live
  conversation is ground truth on conflict. Top-K capped with a byte budget.

  Still gated by `SUA_EXPERIMENTAL_TRIAGE_LEARNINGS`; with the flag off the input
  is empty and the kernel section no-ops. Completes the learnings loop
  (extract on resolve → approve → consult).

- 012eec4: Triage learnings: store + retrieval + flag (dormant plumbing).

  First slice of cross-thread triage learnings (experimental, off by default). Adds a
  `triage_learnings` table to InboxStore with `addLearning`/`getLearning`/`listLearnings`/
  `updateLearningStatus`/`deleteLearning` and a structured-retrieval query
  `listApprovedLearningsForTriage` (keys on agentId + source + scope, newest-approved first,
  capped). Lessons are deduped on a normalized form. Adds a generic `extractTaggedJson(raw, tag)`
  core helper (generalizes `extractPlanJson`) and the `isTriageLearningsEnabled()`
  (`SUA_EXPERIMENTAL_TRIAGE_LEARNINGS`) flag with the CLI config bridge. Nothing is wired into
  the inbox UI or triage prompt yet — that lands in follow-ups.

- d9e482e: Triage can now resolve a thread it has fully handled.

  When a thread is done — the operator says "thanks, that's all", or the request is
  fully answered with nothing left to run or diagnose — triage can close it itself
  with a new `resolve-thread` action instead of telling the operator to click
  Resolve. It sets the thread status to `resolved` synchronously (no agent runs),
  posts a short acknowledgment, and is excluded from the auto-follow-up trigger so
  closing a thread never spawns another triage turn. The kernel teaches strict
  guardrails: never resolve while a question is pending, an action is still
  running, or a reported problem hasn't actually been addressed.

- 0f62759: Inbox triage can now SEE an agent's latest run, and reports failures directly.

  Triage was blind to agent run outcomes, so when an agent in a thread failed it
  could only say "run it and see what happened" — the operator had to run the agent
  and paste the error back. Triage now receives `FOCUS_AGENT_RUN`: the latest run
  output of the agent the thread is about (the message target, or the most recent
  agent a thread action touched), including a "MOST RECENT RUN FAILED" block with
  the failing node and error. The kernel teaches triage to report the failure
  directly (node + error) and propose the fix, instead of asking the operator to
  re-run and report.

- e1d1a50: Inbox triage: confirm one side-effecting action before firing the next.

  When triage would propose several mutations in a single turn (e.g. "make a note
  AND set a reminder"), it now proposes only the first. Each proposed action
  declares an `effect` (`read` or `write`); the route keeps at most one `write`
  card per turn and holds the rest, surfacing a neutral "holding N more…" note.
  Once the operator runs the first write and it completes, the follow-up triage
  turn re-plans and proposes the next from the updated state. Read-only actions
  (catalog search, run analysis, list probes) still batch freely.

- 89294b9: Add `sua worker install-launchagent` for a durable, GUI-session worker (macOS).

  A detached daemon worker can't get the macOS Reminders TCC grant, so background
  agents using the Apple integration's reminder tools were denied. The new
  `sua worker install-launchagent` writes a user LaunchAgent that runs the worker
  in your GUI login session (via `launchctl bootstrap gui/$UID`), where macOS can
  surface the permission prompt and persist the grant across reboots — so
  scheduled/temporal reminder agents work. Paired with `uninstall-launchagent` and
  `launchagent-status`. The fully distributable fix (code-signing the runner) is
  captured in ADR-0026.

### Patch Changes

- fc97965: Inbox: the per-thread action cap now resets on each operator reply.

  The runaway-fan-out guard counted actions over the thread's whole lifetime, so a
  long, actively-driven debugging thread (build → run → analyze → fix → run → …)
  would eventually hit the 10-action cap and refuse to propose further steps even
  though the operator was actively engaging. It now counts actions since the
  operator's last message, so a fresh reply resets the budget — while an autonomous
  refire chain still can't fan out unbounded between replies. The skip note now
  explains that replying continues the thread.

- 47288d0: Inbox: the "approve YAML fix" card now appears when analyzing any agent.

  After agent-analyzer produced a corrected YAML, the auto-proposed `agent-editor`
  approve card was gated on `parsed.id === message.agentId`, so on a manual thread
  (no message agent) or when analyzing an agent other than the thread's, no card was
  created — triage kept saying "approve the queued fix" with nothing to approve.
  It now targets the corrected YAML's own agent id (resolving the fix target from
  the analysis, the same way #524 fixed analyzer dispatch), and only requires that
  agent to be installed.

- e5b3adb: Apple Notes: fail fast instead of hanging 30s when the worker lacks a GUI session.

  `note-create`/`note-read`/`lists` drive Notes.app via AppleScript. From a process
  without a GUI session or Automation grant (e.g. the background temporal worker),
  the Apple event blocks until the 30s spawn timeout ("produced no output"). The
  runner now wraps every AppleScript in `with timeout of 10 seconds` and maps the
  timeout (-1712) and not-permitted (-1743) errors to clear, actionable messages
  ("run it via sua worker install-launchagent", or "grant Automation access").

- df7b0c4: Clearer error when a tool node fails to resolve + multi-worker warning.

  When a node references a `tool:` that doesn't resolve (integration disabled via the
  experimental flag, not installed, or the worker running stale code), the executor
  reported the misleading "Shell node X has no command" / "not found in registry or
  store". It now says: tool "<id>" did not resolve — integration may be disabled, not
  installed, or this worker may be stale (restart it). `sua daemon status` also warns
  when more than one worker is polling the Temporal queue, since competing workers are
  a common cause of these flaky failures (a run lands on an ungranted/stale worker).

- dac2da8: Inbox dashboard-editor: resolve dashboards by name, and auto-link `/dashboards/` refs.

  Two fixes found dogfooding the new `dashboard-editor` action:

  - **No more duplicate dashboards.** add-tile/create now resolve a `DASHBOARD`
    given as a display name ("Morning Brief") to an existing dashboard
    (`user:morning-brief`) by id, slug, or case-insensitive name — instead of
    minting a near-duplicate `user:morning-brief-<ts>`. create is idempotent by
    name.
  - **Dashboard links are clickable.** `linkifyRefs` now auto-links bare
    `/dashboards/<id>` references in triage recommendations (it only handled
    `/runs` and `/agents`), and drops the `user:`/pack namespace from the link
    label so `/dashboards/user:morning-brief` reads as `morning-brief`.

- 5828e49: Fix: inbox triage can analyze any agent, not just the thread's target.

  agent-analyzer's preflight node hard-requires AGENT_YAML, which the inbox route injected only from
  the thread MESSAGE's agentId. So on a manual thread (no agentId) — or when triage wanted to analyze
  a different agent than the thread's target, e.g. one it just built — the YAML was never injected
  and every analyzer run failed at preflight ("Process exited with code 1"). The route now resolves
  the target from an explicit `AGENT_ID` in the action inputs (falling back to the thread's agentId),
  injects that agent's YAML, and refuses up front with a clear message when no agent can be resolved
  instead of dispatching a doomed run. The triage kernel teaches setting `AGENT_ID` to the agent to
  analyze.

- 4ee5f72: Home: inbox-first "Ask sua" CTA + a global top-bar "needs you" toast.

  The unified home had three competing action clusters in the upper-right — the old
  "Build from goal" / "Browse packs" header buttons, the Needs-you strip's "Open
  inbox", and the board's own controls. Now:

  - The header buttons are replaced by a single primary **Ask sua →** that opens a
    fresh inbox thread (`POST /inbox/new`). Build-from-goal still lives on /agents
    and the no-agents empty state.
  - The "needs you" signal moves off the home body into a global **top-bar toast**
    ("N need your reply →") shown in the top-bar empty space on every page whenever
    inbox threads await a reply (count from `/inbox/needs-you-count`). This removes
    the redundant "Open inbox" callout and tightens the home's vertical — the page
    now leads straight into the board.

- d28e40f: Inbox modal: don't yank the operator to the bottom when reading a tall widget.

  When an inline output widget (e.g. a cocktail card) is taller than the thread
  viewport, scrolling up to read its top was repeatedly fought by the poll-driven
  refresh, which swapped the DOM and forced a scroll-to-bottom every tick. The
  refresh now preserves scroll position and only follows the latest content when
  the operator is already near the bottom; the streaming-reply bubble does the
  same; and the post-refresh focus no longer scrolls the composer into view
  (`focus({ preventScroll: true })`).

- c253b1e: Inbox: triage can now summon an agent's widget into a thread.

  Activates the show-widget mechanism. The triage AGENT_CATALOG now carries a `hasWidget` flag
  (true when an agent has an inline output widget), and the triage kernel teaches when to propose
  `show-widget` ("show me X's output" → display the latest run read-only) vs `run-agent` ("run/refresh
  X" → execute). Dogfooded live: asking "show me the <agent> output" surfaces that agent's latest
  output widget inline as a card, with no re-run and no extra triage turn.

- 72f9cff: Inbox: stop triage from rendering an output widget twice in a thread.

  After triage ran an agent in a thread, the follow-up triage turn would
  often propose a `show-widget` action pointing at that same just-completed
  run — but the run-agent card already renders that run's widget inline, so
  the widget appeared twice. The engine now declines a `show-widget` whose
  latest completed run is already shown inline on the thread
  (`showWidgetWouldDuplicate`), and the triage kernel teaches not to
  show-widget an agent it just ran in the same thread.

- 12dd613: Inbox: Stop now halts the autonomous triage chain, not just one turn.

  The triage Stop/Cancel button only aborted the in-flight triage LLM run, but the
  runaway loop is driven by auto-approved actions (agent-analyzer → agent-editor)
  completing and refiring triage — so a fresh turn respawned right after Stop and
  the thread ran until the consecutive-turn cap. Cancel now sets a per-message stop
  flag that `maybeRefireTriage` and the auto-approve dispatch both honor, so the
  chain halts after the in-flight action; the flag is cleared when the operator
  replies. Stop also takes effect when the thing running is a sub-agent action
  (no triage run to abort), posting an acknowledgement note.

- 8f39b45: Clean up the inbox thread-actions UI (fork / retarget).

  Replaced the two free-text "agent id" boxes with a single labeled "Move to"
  dropdown listing installed agents by name, shared by the Fork and Retarget
  buttons (Retarget uses the submit button's formaction so one select drives both
  routes). The inbox AJAX form handler now honors a submitter's formaction. Clearer,
  no more typing exact agent ids.

- 34854da: Fix node-cron type import so the build survives the 4.5.0 bump.

  node-cron 4.5.0 ships a bundled type declaration whose default export no
  longer doubles as a type namespace, so `cron.ScheduledTask` stopped
  resolving (`TS2503: Cannot find namespace 'cron'`). Import `ScheduledTask`
  as a named type instead. Backward compatible with 4.2.1; unblocks the
  Dependabot prod-minor-patch bump.

- 86a2a0b: Refactor: extract the inbox triage/actions engine into its own module.

  Second of three behavior-preserving slices of the oversized inbox route file. The
  triage + action-execution + learning-extraction engine (runTriageAgent,
  runProposedAction, maybeExtractLearning, and the run/refire/auto-propose helpers) moves
  into `inbox-engine.ts`, with the runTriageAgent↔runProposedAction cycle kept internal to
  that one module. `inbox.ts` is now just the 20 route handlers + router wiring (925 lines,
  down from 2249; the engine file is 1355). `TRIAGE_AGENT_ID` moved to the shared leaf so no
  sibling module imports the router file (clean acyclic module graph). No logic changes;
  full suite unchanged at 2018 pass / 3 skip, and the live routes (list, respond→triage,
  fragment, action proposal) were smoke-tested.

- 69da6f8: Refactor: finish the inbox route-file split (drop shims, repoint tests, shape seams).

  Final slice of the inbox.ts refactor. Drops the temporary re-export shims and repoints the
  9 sibling test files to import directly from the new modules (inbox-shared / inbox-catalog /
  inbox-plan / inbox-widgets / inbox-engine), so inbox.ts now exports only `inboxRouter`.

  Also shapes the seams for the planned "inbox span of control" work: a module-map header on
  inbox.ts (route layer only — compose the siblings, don't regrow the god file), labelled route
  bands (read · lifecycle · conversation+triage · metadata · actions · learnings), and a
  doc-comment marking inbox-widgets.ts as the single in-thread output-widget boundary.

  No behavior change. inbox.ts: 3217 (pre-refactor) -> 938. Full suite unchanged at 2018 pass /
  3 skip.

- 6cf1ae2: Refactor: split the leaf helpers out of the oversized inbox route file.

  `packages/dashboard/src/routes/inbox.ts` had grown to 3217 lines. This is the first
  of three behavior-preserving slices: the pure/leaf helpers move into four cohesive
  sibling modules — `inbox-shared.ts` (http/util + shared constants + pure formatters),
  `inbox-catalog.ts` (sub-agent allowlist/catalog/input-enrichment), `inbox-plan.ts`
  (plan/action/link parsing + crash-recovery), and `inbox-widgets.ts` (thread view-data +
  in-thread widget assembly). `inbox.ts` re-exports the moved symbols so nothing else
  changes. No logic changes; full suite unchanged at 2018 pass / 3 skip. inbox.ts is now
  2249 lines; the engine extraction + shim cleanup follow.

- 5b9ddf1: Apple reminder-update: empty optional fields mean "leave unchanged".

  The `apple.apple.reminder-update` tool now omits `title`/`notes`/`dueDate` from
  the payload when they arrive empty, instead of forwarding `""` and blanking the
  field. Tool inputs come through as templated strings with no type coercion, so
  an "edit a reminder" agent that maps every field would otherwise erase the ones
  the operator didn't set. Now only the fields you actually provide are changed —
  which is what makes a single edit-reminder agent (reschedule / retitle / re-note)
  safe.

- edfc556: Clearer node-timeout errors when the machine slept.

  A node's wall-clock timer is suspended while the machine sleeps, so a 300s
  timeout could "fire" hours later and report a misleading "Timed out after 300s"
  on a run that never actually ran that long. The timeout message now detects when
  the elapsed wall-clock vastly exceeds the configured limit and annotates it
  ("limit 300s, but 3.7h elapsed; the machine likely slept...") so run detail
  explains the gap instead of implying a true hang. Operator Stop (cancellation)
  keeps the bare message.

- b8d2ecd: Fix: apply agent input defaults to `{{inputs.X}}` in builtin/generated tool nodes.

  The builtin-tool execution path resolved `{{inputs.X}}` templates against the
  caller's `--input` pairs only, ignoring declared input defaults — so a tool node
  templating a defaulted input received an empty string (e.g. a required field
  failing with "title is required"). Shell/LLM nodes already applied defaults via
  node-env; the tool path now uses the same `mergedInputs` merge, so defaults and
  required-input validation are consistent across node types.

- 98c9ce6: Fix triage reverting to an earlier goal when the operator pivots mid-thread.

  Inbox triage was anchored to the original message body (`MESSAGE_BODY`), which
  is frozen at thread creation. When the operator changed their mind partway
  through a thread, triage kept pursuing the first request and, on auto-follow-up
  turns, re-proposed stale actions (including ones that had already failed),
  ignoring the newer ask. Triage now receives the operator's latest message as a
  first-class `CURRENT_REQUEST` input that takes precedence over the frozen
  original, and the inbox-triage prompt no longer re-proposes failed actions the
  current request has moved past.

- 830744d: Slim and reorder the triage prompt to cut per-turn tokens.

  A measured triage turn was ~15.5K tokens, of which the runnable-agent specs
  (full input schemas, sent every turn) were ~47%. The specs are now compacted to
  the structural minimum triage actually needs — input names, types, required, a
  short truncated description — dropping the redundant agent-level prose (the
  catalog already carries it). That roughly halves the specs block (a measured
  turn dropped to ~12K tokens, -23%), with no loss of the input names triage uses
  to propose actions correctly. The prompt is also reordered so the static prefix
  (rules + catalog) leads and the live message + conversation trail, with a terse
  output reminder last — a cache-friendly layout that preserves instruction
  following.

- a1a3875: Triage can now see a whole run's output, not just the first ~2KB.

  `FOCUS_AGENT_RUN` (the latest run output triage answers from) was capped at 2000
  chars. A verbose data agent — an MLB scoreboard is ~8KB, a full slate of 15
  games — got sliced off after ~4 entries, so triage genuinely couldn't see the
  row the operator asked about ("did the Mariners win?" with the Mariners game
  deep in the payload). The cap is now generous enough (12KB, 14KB total) that a
  full data payload reaches triage intact, still bounded so a pathological dump
  can't blow the prompt (it truncates with an "open the run" pointer). The triage
  kernel also tells it to read the whole payload before answering a data question,
  and to link the run rather than guess when the output is genuinely truncated.

- 98c9ce6: Inbox: a reply over a pending proposed action now retires the card and re-plans.

  Previously, replying while a triage-proposed Run/Skip card was still pending did
  nothing — triage was suppressed until you manually skipped the card. Now a reply
  auto-retires any pending _proposed_ card (shown as "Superseded by your reply",
  attributed to triage rather than the operator) and immediately fires a fresh
  triage turn that plans against your latest message. Running actions are left
  untouched — they can't be safely cancelled mid-flight. Manual skips are now
  explicitly attributed to the operator.

- 370b6af: Refine the top-bar "needs you" badge + a readability/sizing pass on Home & Pulse.

  The global "needs you" toast is now a crafted, right-anchored pill: a soft-amber
  fill with a 1px amber border, a mono count, and a gently pulsing dot
  (reduced-motion-safe), grouped with the theme toggle in a `.topbar__right`
  cluster so it hugs the right edge instead of floating mid-bar. The label now
  pluralizes ("1 needs your reply" / "3 need your reply") and the toast announces
  via `aria-live`.

  Alongside it, a full readability/sizing pass across the dashboard: a new
  `--font-size-2xl` (28px) token plus reusable `.section-label` and `.stat-value`
  utilities, then every hardcoded `font-size` (the 7-12px label soup, the off-scale
  32px stats) and off-grid padding/margin in the stylesheets and view templates
  remapped onto the design tokens — Home, Pulse, Inbox (list/detail/modal), agent
  detail, nodes, and the output widgets. Only intentional values are left raw (the
  16px rem anchor, optical 1px nudges, relative `em` units).

## 0.24.0

### Minor Changes

- 96a11bb: Inbox thread usability (control-plane Phase 2): summary, reopen, fork, retarget.

  A thread is now a stable working surface, not just a transcript:

  - A derived **thread summary** block (goal / status / latest result / next step),
    computed from the thread's responses — no LLM call.
  - **Summarize** pins that summary into the transcript as a system note.
  - **Reopen** flips a resolved/dismissed thread back to open.
  - **Fork to agent** opens a new thread targeting a chosen agent, carrying the
    summary + `forkedFrom` provenance (original thread is untouched).
  - **Retarget** points the current thread at a different agent in place.

  Fork/retarget targets are installed non-system agents. New
  `InboxStore.updateMessage` patches a thread's agent link / context.

### Patch Changes

- 842dea8: Migrate core schemas to zod 4.

  `@some-useful-agents/core` now depends on zod 4 (4.4.3). The only breaking change
  that touched our code was `z.record(valueSchema)` → `z.record(z.string(), valueSchema)`;
  applied across the agent / tool / config schemas. Validation behavior is unchanged
  (full schema test suite green). The MCP server stays on zod 3 to match the
  `@modelcontextprotocol/sdk` types (its bundled `zod-to-json-schema` pins zod 3);
  the two never exchange zod schema instances, so the split is safe.

## 0.23.0

### Minor Changes

- 6d0e45a: feat: per-agent allowedSubAgents allowlist + picklist UI on /agents/:id/config

  Previously the only "sub-agents this agent may propose" allowlist was a
  hardcoded const in `routes/inbox.ts` (`TRIAGE_SUB_AGENT_ALLOWLIST` —
  `agent-analyzer`, `agent-editor`, `agent-catalog-search`) feeding the
  inbox-triage agent's `ALLOWED_SUB_AGENTS` input. Operators couldn't
  customize it without editing code.

  This PR adds a first-class `allowedSubAgents?: string[]` field on the
  Agent schema:

  - **Type + schema + YAML round-trip.** Added to `Agent`,
    `AgentVersionDag`, the Zod schema (with kebab-case validation), the
    YAML import/export, and the agent-store DAG serialisation.
  - **Runtime wiring.** `getSubAgentAllowlist` in `routes/inbox.ts`
    reads `triage.allowedSubAgents` first when set; falls back to the
    hardcoded system-agent list when undefined. Empty array = "text-
    only, no sub-agents allowed."
  - **New route.** `POST /agents/:id/allowed-sub-agents` saves a comma-
    separated `agentIds` list (validates kebab-case, drops self-
    references and duplicates) or accepts `clear=1` to revert to the
    platform default.
  - **Config UI.** New "Allowed sub-agents" card on
    `/agents/:id/config`: shows the current list as removable pills,
    warns when entries aren't installed, exposes "Pick agents…" /
    "Revert to default" buttons. A picklist modal (search + agent
    cards, mirrors the Add Tile pattern) lets the operator stage
    multiple additions before saving.
  - **Tests.** 6 new route tests cover save / dedupe / self-reference /
    empty list / clear / not-installed-warning paths. Full suite 1791
    passing.

- ddade0e: agent-analyzer: friendlier missing-AGENT_YAML error + outputWidget + signal.

  The analyzer used to fail at setup time with an opaque generic
  "missing required input" error whenever it was invoked without the
  dashboard's automatic YAML injection (manual run, scheduled trigger,
  programmatic call). The input is now `required: false` with an empty
  default, and a new `preflight` shell node runs first to validate it.
  On empty input the operator sees a one-shot human-readable message
  naming the three ways to supply the YAML — not a stack trace.

  Also adds the missing `outputWidget` (key-value with classification,
  summary, has_suggested_yaml, source_node) and `signal` (text-headline
  for Pulse), driven by a new trailing `summarize` shell node that
  emits a JSON envelope extracted from the analyze (or fix) output.

  Regression test in `agent-yaml.test.ts` locks in the preflight-first
  ordering + widget+signal declaration.

- 45b220b: New system agent: agent-catalog-search.

  The inbox triage agent can now answer "find me an agent that does X"
  by proposing a `run-agent` action targeting `agent-catalog-search`.
  The dashboard auto-injects a JSON snapshot of every installed
  non-system agent as `AGENT_CATALOG`, so the LLM has the full picture
  without needing any file or grep tool. The search agent returns up to
  5 ranked matches with a one-line `why` for each.

  This unblocks discovery-style triage flows that previously dead-ended
  ("No suitable agent is available in the current allowlist") because
  triage's allowlist only knew about analyzer + editor. Triage's prompt
  now includes a short agent guide describing when to propose each
  allowlisted sub-agent.

- b9c3c1b: Agents expose a created-at timestamp; the catalog can answer "what's the newest agent?".

  `Agent.createdAt` is now populated from the `agents` table on read. The inbox
  agent-catalog snapshot includes `createdAt`, sorted newest-first, so
  `agent-catalog-search` can answer recency questions ("newest / most recently
  added agent") definitively instead of guessing at list order. Inbox triage now
  routes those questions to the catalog search.

- 4720543: fix(core,dashboard): apple-foundation-models reaches the schema + every UI dropdown

  Follow-up to #416. The provider was added to the LlmProvider union and
  spawner registry, but five other sites still hardcoded only
  `['claude', 'codex']`:

  - **agent-v2-schema.ts** — Zod `z.enum(['claude', 'codex'])` on the
    agent-level and node-level `provider` fields. Any agent YAML with
    `provider: apple-foundation-models` would fail schema validation
    before reaching the executor. Now driven by `PROVIDER_IDS` so new
    providers register through one place.
  - **dashboard/routes/versions.ts** — `VALID_PROVIDERS` set + the
    agent-llm save handler's `'claude' | 'codex'` cast both refused the
    new provider. Now sourced from `LLM_PROVIDERS`; error message
    enumerates the full set.
  - **dashboard/views/agent-detail/config.ts** — the per-agent LLM
    defaults card's provider select listed only claude + codex. Apple
    FM was reachable via per-node pin (llm-options.ts) but the
    agent-default UI couldn't pick it.
  - **core/node-catalog.ts** — `llm-prompt` / `claude-code` node docs
    said `'claude' | 'codex'` in the type string and "Run an LLM
    (Claude or Codex)" in the description.
  - **dashboard/views/settings-llm.ts** — intro paragraph still claimed
    "Rate limits, auth failures, and other errors stay on the same
    provider" after PR #415 expanded `shouldFallback` to include both.
    Now reflects the post-#415 policy.

  No new tests — existing 1785-test suite covers the schema + route
  paths via the bundled apple-foundationmodels-prompt agent and the
  node-spawner tests added in #416.

- 22e4023: feat(core): apple-foundation-models LLM provider (on-device, system option)

  Adds `apple-foundation-models` as a third LLM provider alongside
  `claude` and `codex`. Runs entirely on-device via Apple's
  `SystemLanguageModel` / `FoundationModels` framework — no API key, no
  network. macOS 26+ with Xcode CLT (`xcrun`) required.

  **How it works:** A tiny Swift runner ships embedded in
  `packages/core/src/apple-foundationmodels-runner.ts`. On first use
  (`ensureAppleRunner`) we write the source to `~/.sua/runners/`,
  compile with `xcrun swiftc -parse-as-library`, and cache the binary +
  a source-hash sidecar. Subsequent invocations hit the cache. On non-
  macOS hosts or hosts without `xcrun`, the bootstrap returns
  `unsupported` without raising and the LLM waterfall falls through to
  the next provider.

  **Spawner shape:** The runner reads `PROMPT` + `SYSTEM_PROMPT` from
  its environment (not stdin or argv) and prints a single JSON line
  `{ status, response_text, model_name, error_message }`. The new
  `LlmSpawner` fields `resolveBinary`, `buildEnv`, `promptEnvVar`,
  `classifyResult`, and `simulateStream` are all opt-in extensions that
  keep the claude / codex spawners unchanged. `status: "unavailable" |
"unsupported"` map to `binary_missing` so the waterfall falls through
  to the next provider when the host can't actually run the model.

  **Simulated streaming.** Apple FM has no native token-delta stream,
  but the dashboard's typewriter UX expects `output_chunk` events.
  After a successful run the spawner chunks the response text into
  ~30-char pieces and emits synthetic `output_chunk` events at ~8 ms
  intervals (capped at ~1.5 s total). Same code path as real streaming
  on the client.

  **System agent.** The existing `apple-foundationmodels-prompt` user
  agent (which compiles Swift + runs the binary directly via shell
  nodes) is now bundled in `agents/examples/` as a system agent so it
  ships with sua. It demos the underlying mechanics; new agents can
  just set `provider: apple-foundation-models` on any `llm-prompt`
  node and skip the boilerplate.

  **Dashboard:** Per-node provider select (`llm-options.ts`) and the
  `/settings/llm` chain editor (`settings-llm.ts`) now list the new
  provider. Probe results show "reachable" on macOS hosts that compile
  the runner, "unavailable" elsewhere.

- c4f57a1: Auto-detect CSP-blocked image hosts and offer one-click "Allow" on the
  agent config page.

  The dashboard's per-agent CSP `img-src` allowlist is empty by default,
  so a freshly-installed widget that loads an external image (e.g.
  `apod.nasa.gov`) renders broken until the user copies the offending
  hostname from the console into the agent config form. This PR closes
  that loop: a small client listener (`csp-img-report.js.ts`) catches
  `securitypolicyviolation` events filtered to the `img-src` directive,
  finds the owning `.pulse-tile[data-agent-id]`, and POSTs `{agentId,
host}` to `/api/img-block-report`. The new `BlockedImgHostsStore`
  records the pair (with a count + last-seen timestamp). The agent's
  **Config → Permissions** card now shows a **Recently blocked** panel
  above the textarea with one-click pills — clicking `+ apod.nasa.gov`
  hits the existing `/permissions/allow-host` endpoint and clears the
  suggestion.

  Best-effort throughout: missing store, malformed hosts, IP literals,
  and offline POSTs are all silently dropped — the page-render path
  never fails because telemetry is unavailable.

- 63aa99c: feat(dashboard): "Build from goal" honors an optional LLM provider pin

  The Build-from-goal modal now exposes an "LLM provider" select that
  defaults to "Use system default (waterfall from /settings/llm)" and
  offers every registered provider (claude, codex, apple-foundation-
  models). When the operator picks a provider, the chosen id pins the
  head of the waterfall for every llm-prompt node in the surveyor /
  drafter / designer chain. The global fallback chain still applies on
  classified failures (binary missing, timeout, quota, auth, rate-
  limit) — the pin says "try this first," not "use only this."

  Threaded through:

  - `build-from-goal-modal.ts` — new `<select id="build-provider">` with
    every `LLM_PROVIDERS` entry.
  - `build-from-goal.js.ts` — appends `provider=…` to the POST body.
  - `POST /agents/build` + `POST /agents/draft-one` — validate against
    `LLM_PROVIDERS`, pass through.
  - `startBuildSession` + `startDraftOneSession` accept `provider`,
    persist as `session.providerPin`.
  - `kickoffAgentRun` gains a `providerPin` arg; when set, clones the
    agent and stamps every `llm-prompt` (or legacy `claude-code`) node
    with the pin via a new `applyProviderPin` helper. Non-LLM nodes
    (shell, file-write, control flow) are unchanged.
  - Drafter retries + designer kickoff read `session.providerPin` so
    the pin survives the full build flow.

  Unset → existing behavior (each node inherits its declared provider,
  the agent's default, or the global primary).

- ceadf1e: Codex spawner: per-event streaming parallel to Claude (PR 4.5).

  Parallel to PR #404 — extends `codexSpawner` to opt into
  `codex exec --json` and forward the structured event stream into
  the inbox SSE pipeline. Triage replies running on codex now stream
  into the typewriter bubble shipped in PR #405 instead of arriving
  all at once after `addResponse`.

  **Changes** in `packages/core/src/node-spawner.ts`:

  - `buildArgs` adds `--json` so codex emits a JSONL event stream
    instead of raw prose.
  - `parseProgress` handles the codex shape (sampled live):
    - `turn.started` → `turn_start`
    - `item.completed` with `item.type=agent_message` → `output_chunk`
      carrying the full `item.text`
    - `turn.completed` → `turn_complete` with `usage.output_tokens`
      as the turn-count proxy
    - Other event types (thread.started, future tool_use, reasoning,
      etc.) are silently skipped.
  - `extractResult` walks back to the last `agent_message` item and
    returns its text — `--json` makes stdout JSONL, so the previous
    identity passthrough would have stored the raw event stream as
    the run's `result`. Falls back to raw stdout if no
    agent_message line is found (defensive for future event shapes).

  **Caveat (same as PR #404 plan).** Codex emits the full assistant
  text in a single `agent_message` item, not token-by-token deltas
  like claude's `--output-format stream-json`. So the typewriter
  reveal with codex feels like "whole reply arrives ~RTT before
  turn.completed" rather than ChatGPT-style streaming — still a
  visible win over the prior "reply lands at addResponse time"
  behavior, just less dramatic.

  **Live-verified end-to-end** with codex as waterfall primary:
  posted a reply, observed `triage:token` event over the SSE stream
  carrying the full plan JSON before `triage:complete`. The dashboard
  typewriter bubble renders the chunk live.

  13 new codex unit tests covering buildArgs flags, all parseProgress
  branches, agent_message preference in extractResult, raw-stdout
  fallback. 1863 tests pass (+13).

- a1fa57e: Resume an interrupted DAG run in place.

  `executeAgentDag` accepts `options.resume`: given an existing run id, it reuses
  that run's completed node executions (reloading their outputs), clears any
  incomplete node rows, and continues from the first unfinished node instead of
  starting over. This is the foundation for durable Temporal runs (B2) — on a
  worker/activity retry the run picks up where it crashed. No behavior change for
  normal runs. New `RunStore.clearIncompleteNodeExecutions`.

- 2425945: Dashboard crash logging: stack traces + signal names in `dashboard.log`.

  Before this PR, `dashboard.log` only contained the startup banner. If
  the dashboard hit an uncaught exception, an unhandled promise rejection,
  or any route threw, the process died with no trace — operators saw
  "daemon status: stopped" and an empty log.

  Now:

  - A 4-arg Express error middleware (`error-middleware.ts`) catches any
    route that throws synchronously or via `next(err)`, writes a
    timestamped line to stderr (`[ts] ERROR METHOD PATH → STATUS: msg`
    - full stack), and responds with a 500 that points at the log
  - The CLI `dashboard start` command registers
    `process.on('uncaughtException')` and `process.on('unhandledRejection')`
    handlers that write `FATAL ...` lines before exiting 1
  - Shutdown signals name themselves: `dashboard shutting down (SIGTERM)` /
    `(SIGINT)` so the log distinguishes graceful stops from crashes

  The daemon supervisor already pipes stderr to `dashboard.log`, so
  nothing changes operationally — the contents just become useful.

- cb9553d: Auto-backfill `permissions.imgSrc` from outputWidget template at agent
  create/upsert time.

  The drafter prompt teaches the LLM to declare `permissions.imgSrc` for
  external image hosts, but the field is optional and the LLM
  occasionally forgets — leaving the user with a broken-image tile on
  Pulse + a CSP error in the console.

  `AgentStore.createAgent` / `upsertAgent` now run a defense-in-depth
  static-analysis pass: any `<img src="https://HOST/…">` in
  `outputWidget.template` has its hostname extracted, baseline CSP
  hosts filtered out (img.youtube.com, i.vimeocdn.com), and the union
  merged into `permissions.imgSrc` before persistence. Wildcard entries
  the drafter declared (e.g. `*.unsplash.com`) are preserved — the
  analyser can't infer those. Idempotent — re-saving an agent whose
  hosts are already declared doesn't bump the version.

  Belt-and-suspenders with the runtime inline-allow card (#377): every
  new draft now ships with correct permissions; existing agents pick up
  the backfill on their next save. The card stays as the catch-all for
  late-binding images and edge cases.

- 2f5741a: Improve-layout: wireframe preview + layout-quality pills.

  The plan view now renders a 4-column wireframe mockup above the Top
  agents list. Each cell shows the agent title, the planner's chosen
  size, tileFit indicator (↕ grow / ⇵ scroll), and pinned height when
  set. System tiles get a dashed border to distinguish them. The
  preview is a `<details open>` so users can collapse it.

  Suggestion pills gain three layout-quality intents — **Remove gaps**,
  **Make tables scrollable**, **Compact everything** — that drive the
  planner to use `suggestedSize` / `suggestedTileFit` /
  `suggestedHeight` aggressively. They appear ahead of the existing
  agent-curation pills (Group by topic, Rank by reliability, etc.).
  Max suggestions bumped from 5 to 6 so the new pills don't crowd out
  the popular ones.

- 462e223: Inbox triage can now propose running `agent-analyzer` (the agent
  behind the "Suggest improvements" button) as a sub-agent action.

  When triage proposes `{type:'run-agent', agentId:'agent-analyzer',
inputs:{FOCUS:'…'}}` in its `<plan>`, the route auto-injects the
  failing agent's full YAML as `AGENT_YAML` and the most recent run
  output as `LAST_RUN_OUTPUT` — same enrichment the analyze route on
  the agent detail page uses. Triage only has to provide a one-sentence
  `FOCUS`; it doesn't have to thread the YAML through its prompt
  context. The agent is lazy-imported from `agents/examples/` on first
  call, so no manual install step is required.

  Hooks the inbox's action loop into a real, useful agent instead of a
  stub. Future allowlist entries can add their own per-agent input
  enrichment using the same pattern.

- 1bacb32: Inbox triage can now apply YAML fixes to agents, not just suggest them.

  After `agent-analyzer` completes inside an inbox triage action, the
  route extracts the `<yaml>...</yaml>` block from the analyzer's
  `analyze` (or `fix`) node output and auto-proposes an `agent-editor`
  action card with a unified diff against the agent's current YAML.
  The operator reviews the diff in-place, clicks Run, and the route
  commits a new version via `agentStore.upsertAgent` (undo via the
  agent detail page's version history).

  - New `agents/examples/agent-editor.yaml` — minimal stub documenting
    the contract. The actual write is performed synchronously inside
    `runProposedAction` (special-cased via `ROUTE_HANDLED_AGENTS`),
    not by dispatching the DAG.
  - New `transitionActionStatus` already in place from PR #388 gives
    the editor the same race-safe idempotent treatment as analyzer.
  - Validation: refuses NEW_YAML that fails `parseAgent`, refuses when
    parsed id doesn't match `AGENT_ID` (prevents accidental cross-agent
    edits).
  - Triage prompt updated to clarify: do NOT propose `agent-editor`
    directly — propose `agent-analyzer` and the route's auto-propose
    handles the rest.
  - Unified-diff renderer in the action card (hand-rolled LCS, ~50
    LOC, no new deps) with `+`/`-`/` ` line styling.

  Verified end-to-end in browser: demo-failing-agent → reply →
  analyzer proposed → run → editor auto-proposed with diff →
  run → demo-failing-agent committed at v2.

- 6569863: feat(dashboard): auto-approve trusted sub-agent chain from triage

  When triage proposes an action against a known-safe system agent
  (`agent-analyzer`, `agent-editor`, `agent-catalog-search`), the action
  card now transitions straight from `proposed` to `running` without
  waiting for an operator click. Anything outside this set still requires
  manual Run.

  The transition uses the same atomic `transitionActionStatus` pattern as
  the manual /run route, so a concurrent operator click no-ops idempotently.
  The Layer 1 commitment chip stays pulsing through the run; on completion,
  the existing `runProposedAction` path publishes the terminal
  `action:status` event exactly as it would after a manual click.

  Layer 2 of the triage follow-through plan
  (`~/.claude/plans/triage-follow-through.md`). Layer 3 (sub-agent
  completion re-invokes triage for a wrap-up turn) ships next.

- 5755df3: Inbox: bulk dismiss + better search, and live-updating direct threads.

  - Select multiple inbox messages and dismiss them in one action, with improved
    search over the message list.
  - Direct inbox threads now live-update as responses arrive, instead of needing a
    manual refresh.

  (Restores work that lived only on an unmerged branch; landed onto main as part of
  the inbox-branch consolidation.)

- bede673: Add CTA affordances to inbox triage replies.

  Triage can now attach an optional `ctaLabel` to a proposed action (so the
  dispatch button reads "Describe this agent" instead of the generic "Run") and
  an optional `links` array to its plan, rendered as link-CTA buttons under the
  reply. Link hrefs are validated against the sanitizer's URL allowlist (relative
  or http(s)/mailto only). Dispatch CTAs reuse the existing action pipeline, so
  they still run and update the conversation inline without a refresh.

- 4170a87: Inbox MVP — dashboard surface (PR 2/2 of the Inbox MVP).

  Wires the `InboxStore` from PR 1 into the dashboard:

  - Top nav gains an **Inbox** entry between Scheduled and Agents
    (`activeNav: 'inbox'`)
  - `GET /inbox` renders a priority-grouped list (High / Medium / Low
    sections) with row columns: agent, title, source, age, status.
    Mirrors the runs-list table pattern.
  - `GET /inbox/:id` renders a detail page with priority/source/age/status
    badges, the message body, a collapsible Context payload, and a
    placeholder for the conversation thread + recommendation that
    arrive in PR 4
  - `inboxStore` wired into `DashboardContext` (optional — booting
    without it renders the empty state)
  - New `SUA_INBOX_DEMO=1` env flag seeds one message per priority on
    boot so the UI is visible before producers are wired in PR 3.
    Disappears when PR 3 lands.

  The MVP is read-only. Producer hooks (failed runs, CSP-block
  escalation, cadence agent), mutation routes (dismiss / respond /
  triage), CLI verbs, and verification all ship in follow-up PRs.

- b42da56: Humanize timestamps and auto-link run/agent references in inbox messages.

  Bare ISO timestamps in message prose (e.g. `2026-05-30T04:15:41.198Z`) now
  render as `May 30, 2026 (3d ago)`, and bare `/runs/<id>` / `/agents/<id>`
  references become clickable links. Both run as pre-passes before Markdown
  rendering, so existing Markdown links and inline code are left intact.

- 10830bb: Render inbox message bodies as Markdown.

  Triage, user, and system messages, the producer summary, and action rationale
  now render through the Markdown pipeline (`renderMarkdownSafe`, wrapped in a
  scoped `.inbox-md` container) instead of plain escaped text — bold, code,
  lists, links, and headings display properly in conversations. Output is still
  sanitized, so raw HTML stays inert.

- d2f44ae: Add a zero-dependency Markdown renderer for chat/message bodies.

  New `renderMarkdown` / `renderMarkdownSafe` helpers in core render the small
  Markdown subset used in conversations (bold, italic, inline + fenced code,
  links, lists, blockquotes, headings, soft line breaks). `renderMarkdownSafe`
  composes the renderer with the existing HTML sanitizer as the trust boundary,
  so output is safe to inline. This is the foundation for rendering inbox triage
  messages as formatted text instead of plain escaped strings.

- 57853de: Add markdownToText for clean one-line previews.

  New `markdownToText` helper in core reduces Markdown to single-line plain text —
  unwrapping links to their label, dropping emphasis/code/heading/list/quote
  markers, and collapsing whitespace. Foundation for de-noising the `/inbox`
  list-row previews (which currently show raw Markdown syntax).

- 49b4d7c: Inbox modal: preserve selections + triage now dispatches CSP permission edits.

  Two fixes bundled:

  1. **Selection-preserving polls.** The modal polls every 1.5s and used
     to replace `content.innerHTML` unconditionally, destroying any
     text the operator had highlighted in the conversation (e.g.
     copying triage's reply) and pulling focus out of the composer.
     The poll now skips the DOM swap entirely when the operator is
     actively interacting — focus inside the modal or a text selection
     anchored inside it — and just reschedules the next tick.

  2. **Triage dispatches CSP-block permission requests.** Previously the
     triage prompt told operators to open Config → Permissions and
     edit the agent by hand. Now it routes csp-block messages through
     the existing analyzer → editor pipeline: it proposes
     `agent-analyzer` with a surgical FOCUS that names the exact host
     to add to `permissions.imgSrc`, which emits a minimal YAML diff
     and auto-proposes an `agent-editor` action card for one-click
     approval. New OUTPUT FORMAT example covers the
     apod.nasa.gov / demo-astro-tile case verbatim.

- 4d80c00: Inbox modal: thinking indicator now shows after Post reply, timeline
  no longer scrolls behind the composer, witty waiting labels rotate.

  Three fixes bundled — both bugs surfaced live while building the
  streaming UX (plan path B, PR 1 of 4):

  1. **Thinking indicator never appeared after Post reply.** PR #397's
     `userIsInteracting()` skipped the DOM refresh whenever focus was
     inside the modal. Post-reply the textarea clears but focus stays
     in it, so the refresh would silently skip forever — the operator
     saw nothing happen and couldn't tell whether triage was running
     or had crashed. Refresh only worked on full page reload.
     `userIsInteracting()` now treats an empty focused textarea/input
     as NOT interacting (no caret position to wipe, no in-progress
     text). Selections and non-empty inputs still suppress refresh,
     so the original "don't wipe text selections" guarantee from
     PR #397 holds.

  2. **Timeline avatars scrolled behind the composer.** The composer
     uses `position: sticky` but the timeline avatars carry
     `z-index: 1` so they punch through the rail line. Without an
     explicit stacking context, the avatars from the last messages
     bled through the sticky composer on long conversations.
     Composer now gets `z-index: 2` on top of its solid background.

  3. **Witty waiting labels.** The thinking indicator now rotates
     through a curated phase-aware label set: triage thinking gets
     "Pondering…", "Distilling tokens…", "Marinating thoughts…",
     "Cogitating…", etc; action-running gets "Dispatching…",
     "Crunching…", "Tracing call graph…"; verifying gets
     "Double-checking…", "Sanity-checking…". 2s cadence with a 220ms
     cross-fade. `renderThinkingIndicator` gains a
     `data-thinking-phase` attribute so the right label set is used.
     The action-card running state picks up the same affordance.

- 64efb83: Pin a "Needs you" section at the top of the inbox.

  Threads awaiting your reply (status "Your turn") now float into a dedicated
  "Needs you" section at the top of `/inbox`, ordered longest-waiting-first, so
  what needs an operator reply is always first. They're removed from the main
  list (no double-listing), and the now-redundant "Reply to triage" banner
  suggestion is dropped; the suggested-actions banner points at the section
  instead of showing misleading "all resolved" copy.

- a8d6750: Inbox is now the primary productivity surface: tighter nav, gridded
  list with inline preview, suggested-next-actions banner, favorited
  threads rail, + New conversation button, and a vertical timeline
  modal with a pinned composer.

  - **Top nav reorder**: Inbox moves to the leftmost position. Scheduled
    moves into the Agents sub-nav (joins Tools / Nodes / Runs / Packs).
    No URL changes — `/scheduled` still works.
  - **/inbox shell**: two-column grid with a collapsible "★ Favorited"
    left rail (state persisted in `localStorage`), a `⚡ Suggested next
actions` banner above the list (deterministic counts of
    high-priority / untriaged / awaiting items; collapsible), and a
    priority-grouped main list of gridded rows.
  - **Inline preview**: every row gains a chevron that toggles a body +
    context-payload preview in place with an "Open thread" button. No
    modal needed for a quick triage glance.
  - **+ New conversation**: button in the page header. `POST /inbox/new`
    creates a `source: manual` row, returns `X-Inbox-Id` for AJAX, opens
    the modal on the new empty thread; first reply auto-fires triage.
  - **Modal timeline**: conversation rendered as a `<ul.inbox-timeline>`
    with a vertical rail line and avatar dots at each entry. The
    existing `.inbox-msg` / `.inbox-action` / `.inbox-action__diff`
    cards become typed objects on the timeline — no data-shape changes.
  - **Pinned composer**: textarea + actions row stick to the bottom of
    the modal so the reply box never disappears while scrolling long
    threads.

  Tests updated for the new shell; new tests cover `POST /inbox/new`
  (AJAX 204 with `X-Inbox-Id`, plain-form 303, empty-title fallback)
  and the favorited rail. 1789 tests pass.

- 7b02df8: Inbox modal: optimistic reply UI + double-submit guard.

  Operators were double-clicking Post reply during the network +
  LLM-kickoff window and getting duplicate "You" messages in the
  conversation. The disable-on-submit only fired in the current event
  loop and didn't survive `refresh()` re-rendering the form, so the
  second submit slipped through to the route.

  Two fixes:

  1. **In-flight guard.** `data-inflight="1"` on the form is checked at
     the very top of the submit handler — a duplicate submit (rapid
     double-click, Enter-then-click) is dropped before fetch fires.
     The flag clears on success and failure so legitimate retries
     after a failed POST still work.

  2. **Optimistic reply.** For the Post-reply path, the modal JS
     echoes the operator's message into the timeline immediately:
     a `<li>` matching renderConversationEntry's structure with a
     `data-pending="1"` marker, italic + 0.55 opacity styling, "You ·
     Sending…" meta. The textarea clears, the viewport scrolls to
     the new entry. On success, refresh() replaces the placeholder
     with the canonical server-rendered entry; on failure, the
     placeholder is removed and the textarea text restored so the
     operator can edit and retry without losing their input.

- 784becb: Inbox: triage can request permission to run an agent instead of dead-ending.

  Previously, when an installed agent hadn't been granted `inboxRunnable`, triage
  would refuse ("I can't run X from this thread") and the operator had to go find
  the agent's Config toggle. Now triage may propose running such a "candidate"
  agent, and the dashboard renders it as a one-click **"Enable & run"** card:
  approving it grants `permissions.inboxRunnable` to the agent (revocable from its
  Config) and runs it in the same step, with output rendered inline.

  The grant only happens on explicit operator approval — candidates are never
  auto-run — and is scoped to installed local/community agents (never system
  agents).

- 0099381: Inbox UX polish pack: row signal column, resizable modal, copy
  button on conversation turns, dismiss-aware empty state, and
  read-only archive view.

  **Right-side row signal.** Raw snake_case status badges
  (`awaiting_user`, `open`, `triaged`) replaced with human labels
  ("Your turn", "Open", "Triaged", etc.). "Your turn" gets the warn
  (amber) badge variant plus a subtle left-edge accent on the row —
  the only state that demands a click stays loud, the rest fade. Age
  and status now live in one signal cell on the right so the eye
  scans them together. Modal status badge picks up the same
  vocabulary.

  **Resizable modal.** Drag the bottom-right gripper to grow the whole
  modal. The composer stays pinned at the bottom; the conversation
  timeline gets the extra room. Replaces the prior `resize: vertical`
  on the textarea (which expanded just that one cell — not what
  operators reached for).

  **Copy button on conversation turns.** Each user/triage/system entry
  gets a "Copy" affordance in its meta row, invisible until the row
  is hovered. Clicking copies the message body via
  `navigator.clipboard.writeText` (with a textarea-select fallback for
  older browsers). The label briefly switches to "Copied" / "Copy
  failed" and the button picks up an ok/err color for 1.5s.

  **Dismiss audit trail + dismiss-aware empty state.** Dismissing via
  the modal now hard-reloads the inbox page so the suggestion banner
  counts, priority group headers, and favorited rail all stay in
  sync. An "Inbox cleared" empty-state copy replaces the generic
  "Nothing in your inbox" when there's terminal-state history,
  acknowledging the cleanup work and offering the archive link. A
  quiet "View N dismissed / resolved →" footer link sits below the
  active list whenever the archive isn't empty.

  **Read-only archive view.** `?status=dismissed` and `?status=resolved`
  on `/inbox` show the terminal-state rows under a muted header with
  a "← Active inbox" back link, so operators can review or confirm
  what they just cleared.

- bb521bd: Show an always-visible one-line preview on every inbox row.

  Each `/inbox` row now renders a clean one-line preview of the latest activity
  (avatar + role + de-markdowned snippet via `markdownToText` + humanized dates)
  directly under the title, so the inbox is skimmable without expanding each row.
  The chevron still expands the full detail panel (proposed actions, context,
  tags, Open-thread). Fixes raw Markdown (`**bold**`, `[x](/agents/y)`, ISO
  timestamps) leaking into list previews.

- a2abb92: Inbox: run agents in a thread and see their output rendered inline.

  - New per-agent `permissions.inboxRunnable` opt-in. Triage can propose running
    any installed local/community agent that declares it, approval-gated.
  - Completed inbox action results now render the agent's output widget **inline**
    in the thread (with a "Raw result" fallback), instead of just a text preview.
    Inline widget images are gated by the agent's CSP image-host allowlist, with a
    one-click "Allow host" affordance when a host is blocked.
  - Agents auto-committed from an inbox build are now stamped `inboxRunnable: true`,
    so "build me an agent, then run it" works inline in a single thread without an
    extra install step.

  (Consolidation: supersedes the thread-scoped inline-run heuristic shipped in #464
  with the first-class `inboxRunnable` capability model.)

- 23dcf9d: Inbox: in-place modal + Slack-style triage conversation.

  Dogfood feedback: "doesn't feel fluid to have to go to a new page load
  to have a conversation about the current row, and I'd like the triage
  agent to join the thread." A previous take stalled because the modal
  polled on a `triageRunId` marker that races the dag-executor — when
  the executor's run-store row landed after the modal's first refresh,
  polling stopped and the agent's reply never appeared.

  This PR:

  - **Single sortable grid** (Priority / Source / Agent / Title / Age /
    Status) replacing the three priority-grouped tables. Click any
    column header to sort; the active column shows ↑/↓. Priority and
    Source render as colored badges (warn/info/muted) so high-pri and
    run-failure rows pop visually.
  - **In-place modal** opens on row click — no page navigation. The
    `<a href="/inbox/:id">` link still works as a fallback for
    right-click "open in new tab" and no-JS users. Esc / backdrop /
    Close all dismiss.
  - **Slack-style conversation thread**: avatar + name + timestamp +
    body per entry, colour-coded by role (YOU teal, TRI info-blue,
    SYS muted). New entries on each fragment refresh get a one-shot
    `inbox-msg--new` slide-in animation. The conversation pane
    auto-scrolls to the bottom when new content lands.
  - **Animated "thinking..." indicator** with three pulsing dots
    (Slack-style typing). Replaces the previous static text.
  - **Reliable polling**: the modal force-polls for 30s after every
    Reply / Ask-triage submit, in addition to honouring the
    `data-triage-pending="1"` marker. The server-side fragment also
    reports pending when the latest response is a user reply <30s old
    with no later triage/system reply — covers the unavoidable race
    between POST returning 204 and the dag-executor's run-store row
    appearing.
  - **`agents/examples/inbox-triage.yaml`** — `source: examples`
    system agent. Single llm-prompt node; takes message + context +
    conversation as inputs; emits `<plan>{messageId, recommendation,
verifyHint}</plan>` parsed by the route (mirrors layout-planner
    pattern; no new built-in tool, no SSRF whitelist).
  - **`POST /inbox/:id/triage`** inserts a synthetic "Asked triage to
    take another look" user marker before kicking off the agent, so
    the operator's action is visible in the thread.
  - **Dual-mode mutation routes**: 204 with no body for AJAX (modal
    fetch), 303 redirect for plain form posts (fallback page).
  - 16 route tests cover sort, fragment rendering with avatars,
    pending-indicator derivation, all three mutation routes in both
    modes, and synthetic-marker insertion on /triage.

- 1ccb34d: Inbox conversation SSE: structured event bus + EventSource client.

  Plan path B, PR 2 of 4. Replaces the 1.5s fragment poll for active
  conversations with a server-sent-events stream so action card
  transitions and triage replies land at network RTT instead of poll
  cadence. The fragment poll stays as a fallback when SSE is
  unavailable or disconnects.

  **Event bus.** `packages/dashboard/src/lib/inbox-event-bus.ts` —
  in-memory pub/sub keyed by `messageId`. Each channel keeps a
  50-event ring buffer for `Last-Event-ID` replay; a 5-minute idle GC
  drops abandoned channels. Listener errors are swallowed so one bad
  subscriber can't starve the rest.

  **SSE endpoint.** `GET /inbox/:id/events` in
  `packages/dashboard/src/routes/inbox-events.ts`. Standard SSE
  headers (`text/event-stream`, `Cache-Control: no-cache, no-transform`,
  `X-Accel-Buffering: no`), 2KB initial padding to defeat proxy
  buffering, 15s heartbeat. Honors `Last-Event-ID` for reconnect
  catch-up. Cookie auth (EventSource sends same-origin cookies
  automatically).

  **Publish hooks** in `routes/inbox.ts` at every lifecycle sync point:
  user reply persisted → `message:created`; `runTriageAgent` start →
  `triage:started` + `state(thinking)`; triage reply persisted →
  `triage:complete` + `state(done)`; each proposed action card →
  `action:created`; every action status transition (running, skipped,
  completed, failed, refused) → `action:status`.

  **Client.** `inbox-modal.js.ts` opens an `EventSource` per modal,
  listens to all event types, and schedules a single `refresh()` per
  animation frame on any event (the SSE notification is the wake-up
  signal; canonical state still comes from `/fragment`). A 20s
  watchdog forces a fragment refresh if no events or heartbeats
  arrive, keeping the UI consistent even when SSE proxies misbehave.

  PR 3 will start emitting per-token `triage:token` events from the
  claude CLI; PR 4 will start patching DOM incrementally for those.

  Tests: 14 new bus tests covering publish/subscribe semantics, ring
  buffer overflow, Last-Event-ID replay, idle GC, throwing-listener
  isolation. 4 new SSE route tests covering wire format, auth, 404,
  and Last-Event-ID replay. Total 1841 pass (+18).

- e83b3ea: Inbox: star + tags + search/filter + sticky modal header.

  Dogfood feedback: the modal title + body scrolled off-screen while the
  conversation grew, and there was no way to find a specific thread
  without scrolling the list.

  - **`InboxStore` schema**: adds `starred` (boolean) and `tags_json`
    (JSON array) columns to `inbox_messages`. ALTER TABLE migrations
    are idempotent so existing installs pick them up. New helper
    `normalizeTags` lowercases / dedupes / sorts / drops invalid
    entries (must match `^[a-z0-9][a-z0-9_-]{0,31}$`).
  - **`InboxStore.list`** gains `q` (full-text across title, body,
    agent_id, AND any conversation response body), `starred`, and
    `tag` (exact lowercase match, not substring) filters. Starred
    messages always sort above non-starred at the same priority.
  - **`InboxStore.setStarred` / `setTags` / `listAllTags`** new
    methods.
  - **Routes**: `POST /inbox/:id/star` (toggle / explicit value),
    `POST /inbox/:id/tags` (comma-separated input, normalized
    server-side). `GET /inbox` reads `?q` `?starred` `?tag` query
    params; all live in the URL so filtered views are bookmarkable.
  - **List view** gains a filter bar (search input + Starred-only
    checkbox + All-tags dropdown), a star column, and tag chips on
    each row's title cell. Chips link to `/inbox?tag=…` for one-click
    filtering.
  - **Modal**: the title + meta + tags + details + context wrap in
    `.inbox-detail__header` which uses `position: sticky` so the
    conversation thread scrolls below an always-visible header. Star
    toggle lives in the meta row; tag editor sits beneath the meta.
    Both forms POST via the existing modal `fetch` interceptor —
    in-place updates, no page reload.
  - 36 new tests across the store (10 for star/tags/list-filters) and
    routes (~10 for filter rendering + the two new mutation routes +
    list-row + fragment rendering).

- 762574f: Inbox store foundation — SQLite-backed queue for "needs your attention".

  First of a 5-PR sequence (this is the MVP base; the dashboard UI lands
  in PR 2). Adds `InboxStore` in core with:

  - `inbox_messages` table keyed by id, with priority (high/medium/low),
    source (run-failure / permission-request / cadence / manual),
    status (open → triaged → awaiting_user → verifying → resolved, plus
    `dismissed` as terminal), and a `dedupe_key` UNIQUE column so
    producers can fire-and-forget without state
  - `inbox_responses` table for per-message conversation threads
    (role: user / triage / system), used by later PRs
  - Public API: `add`, `list`, `get`, `findByDedupeKey`, `updateStatus`,
    `dismiss`, `addResponse`, `listResponses`, `clear` — mirrors the
    canonical pattern from `BlockedImgHostsStore` / `LayoutHintsStore`

  `list()` default-orders by priority (high first via CASE expression,
  since alphabetical sort would put low before medium) then created_at
  DESC, and default-excludes `dismissed` and `resolved` so the queue
  shows only active work.

  Producers, dashboard UI, top-nav entry, triage system agent, CLI verbs,
  and verification loop all ship in follow-up PRs. The schema is locked
  now (including unused-in-MVP columns like `triage_run_id` and
  `recommendation`) to avoid migrations.

- adf70b5: InboxStore: sortable list + derived last-activity timestamp.

  Foundation for the inbox queue UX pass (PR 1 of 2). Adds:

  **`ListMessagesOpts.sort` + `dir`.** New `InboxSortKey` union
  (`priority` | `status` | `age` | `title` | `agent`) and
  `InboxSortDir` (`asc` | `desc`). Default sort stays
  priority-then-last-activity-desc so existing callers see no
  behavior change.

  **`InboxMessage.lastActivityAt?: number`.** Derived at `list()`
  time via a correlated `MAX(inbox_responses.created_at)` subquery,
  falling back to the message's `created_at` when no replies
  exist. Drives the queue's "Age" column under default sort and
  the explicit `?sort=age` case. `get()` and other single-row
  reads leave it undefined (no join cost on the hot path).

  **ORDER BY composition** via `buildOrderBy(sort, dir)`. All sorts
  tie-break by last-activity desc so results are stable when the
  primary key has duplicates. Starred messages float to the top
  regardless of sort. `agent` sort puts unagented rows last
  regardless of direction so they don't crowd the head of the
  list. Unknown keys fall back to priority semantics.

  Adds 9 new store tests covering: lastActivityAt derivation +
  fallback, default sort (priority desc + activity bump), `age`
  sort both directions, `status` sort with "Your turn" first,
  `title` sort case-insensitive, `agent` sort with nulls-last,
  starred-pinning, unknown-key fallback. 1873 total tests pass
  (+10 — 9 new + 1 from the existing dashboard tests picking up
  the lastActivityAt field).

  PR 2 wires the route + view to honor the new sort knobs, drops
  the priority-group cards, adds the sticky sortable header, and
  rebuilds the expanded preview as an activity strip.

- bc062ce: feat(inbox): auto-rename "New conversation" threads from first reply

  When the operator posts the first reply on a manual-source thread that
  still carries the default `"New conversation"` title, the route now
  replaces the title with a single-line, ellipsized version of the body
  (up to 60 chars). Threads created with an explicit title are
  preserved; subsequent replies never re-rename; non-manual sources are
  untouched.

  fix(dashboard): Add tile click no longer triggers Chrome "Leave site?"
  guard. The agent-card click handler in `add-tile-modal.js.ts` called
  `form.submit()` directly, which bypasses the form's `submit` event —
  so `widget-layout.js`'s edit-mode beforeunload guard never got a
  chance to clear `intentionalNav` and Chrome's generic dialog stacked
  on top of the legit POST. Switched to `form.requestSubmit()` (same
  fix pattern as the inbox Cmd/Ctrl+Enter handler).

- 5448687: Inbox streaming: per-token capture from Claude CLI to SSE bus.

  Plan path B, PR 3 of 4. Extends the SSE pipeline so triage replies
  stream text chunks live instead of materializing all at once when
  the DAG completes. PR 4 will hang the typewriter reveal off these
  events.

  **Core change.** `claudeSpawner.parseProgress`
  (`packages/core/src/node-spawner.ts`) now inspects the `content`
  array of every `assistant` event from the `--output-format stream-json`
  output. Each text chunk emits an `output_chunk` SpawnProgress with
  the actual text in `message`. Tool-use content still produces
  `tool_use` events. Empty assistant events fall back to `turn_start`
  ("Claude is responding…") so the UI keeps an alive signal.

  **Decoupling hook.** New optional `DagExecutorDeps.inboxOnProgress`
  forwarder. The dag-executor's existing progress collector
  synchronously calls it (alongside the DB `progressJson` write)
  with `{nodeId, progress}`. Errors swallowed so a misbehaving
  adapter can't break a run. Core knows nothing about the bus.

  **Dashboard adapter.** `runTriageAgent` passes an `inboxOnProgress`
  that filters `output_chunk` and republishes as `triage:token`
  SSE events with `{nodeId, chunk, at}` payload.

  Live-verified: with claude as the waterfall primary, posting to
  /inbox/:id/triage produced a `triage:token` event over the SSE
  stream with the assistant's full plan JSON chunk before the
  `triage:complete` event fired. Codex still doesn't stream per-token
  (parseProgress returns null) — out of scope for this PR; future
  work can wire it in the same shape.

  8 new parseProgress unit tests covering text deltas, tool-use,
  text+tool-use priority, empty assistant events, empty text deltas,
  result events, top-level tool_use, unknown event types. 1850 tests
  pass (+9).

- 5e9689a: Inbox toolbar + modal polish — tighter, denser, fewer competing
  visual elements.

  **Toolbar** (`/inbox` upper-right):

  - Drops the bordered card around the filter group; controls sit on
    the page background.
  - Search input becomes a single 32px-tall pill with inline `⌕` icon
    and `×` clear button; submits on Enter and 350ms debounced input.
  - "Starred" checkbox → chip toggle (active state filled, inactive
    outlined). Auto-submits on change.
  - "All tags" → unstyled select inside a `# tags` chip. Auto-submits.
  - Apply button removed entirely.
  - `Clear` link renamed to `Reset` for consistency with other
    toolbars.

  **Modal** (per-thread):

  - `×` close button in the top-right corner; the separate "Close"
    link at the bottom-right is gone.
  - Title row tightened: title + star only. Source label removed
    (it's implicit in the agent/run links and surfaced on the list).
  - Meta row consolidated: priority dot + status badge + agent link +
    run link + age (right-aligned). Replaces the old loose flex of
    pills and timestamps.
  - Tags now render as pills with inline `×` to remove; an
    always-present "Add tag…" input appends on Enter. Replaces the
    textarea + Save tags button.
  - "DETAILS" and "CONTEXT PAYLOAD" headings removed — body lands
    directly; context becomes a small `▸` disclosure.
  - "Reply" label dropped (placeholder is enough).
  - Footer consolidated to ONE right-aligned row: `Ask triage`,
    `Dismiss`, and `Post reply` cluster together so the eye finds the
    primary action in a predictable spot. The primary button reaches
    the textarea form via `form="..."` so the composer + actions can
    occupy distinct visual zones without nesting.
  - Grid-row unification: list-view rows and the modal share the same
    priority-dot + agent/run-link vocabulary, and the group headings on
    the list lighten (no uppercase, no raised background, no hard
    bottom border) so they read as section labels rather than
    competing chrome.
  - Empty-body conversations (manual `+ New conversation` threads with
    no seeded body) hide the `(empty)` placeholder so the modal opens
    clean until the operator's first reply lands.
  - Add-tag input renders as a dashed pill so it visually matches the
    existing tag pills instead of showing a bare borderless field with
    a heavy browser focus outline.

  All CSS uses existing design tokens. No schema or route changes.
  1808 tests pass.

- d938114: Inbox triage can now propose running sub-agents on your behalf.

  The `inbox-triage` agent learns about an `ALLOWED_SUB_AGENTS` allowlist
  and may include an `actions[]` array in its `<plan>` block. The
  dashboard renders each proposed action as a card in the conversation
  thread with Run / Skip controls — nothing executes until the operator
  clicks Run. Running an action invokes the target agent via
  `executeAgentDag`, streams the row through `proposed → running →
completed | failed`, and surfaces a result preview + run link. After
  the last proposed action resolves and at least one ran, triage gets a
  follow-up turn to summarize what came back.

  New: `action` response role, `InboxActionMeta` payload (stored in
  `inbox_responses.meta_json`), and routes `POST /inbox/:id/actions/:rid/run`
  and `/skip`. Modal polling extends to keep refreshing while any action
  is in `running` state. Hard cap of 10 actions per message guards
  against runaway proposal loops; out-of-allowlist or malformed actions
  land as `system` refusal notes.

  The v1 allowlist is hardcoded to `suggest-improvements` (intersected
  with installed agents at runtime).

- cd970d2: inbox-triage: auto-refresh the triage agent itself from bundled YAML.

  PR #398 added auto-refresh for the SUB-agent allowlist (analyzer,
  editor, catalog-search) but `inbox-triage` itself was left out. So
  operators who installed inbox-triage before PR #395 — which added
  the VOICE section telling the model to write the recommendation AS
  the assistant reply, not as stage directions — kept seeing
  "Reply directly with X: ..." prefixes on every triage turn, even
  after running the latest dashboard build.

  Extracts the diff-and-refresh logic into `ensureSystemAgentCurrent`
  and calls it for the triage agent at the start of `runTriageAgent`.
  Same diff trigger: refresh fires when the installed exported YAML
  differs from `agents/examples/inbox-triage.yaml` on disk.

- 52043c5: Let inbox triage answer catalog questions directly.

  The triage agent now receives a trimmed installed-agent catalog (newest first,
  with descriptions and install dates) on its own turn, so questions like "what's
  the newest agent and what does it do?" are answered immediately — named,
  described, dated in human form, and linked to `/agents/<id>` — instead of
  dispatching a catalog-search round-trip and hedging. The prompt also instructs
  triage to write Markdown, link runs/agents, humanize dates, and offer link CTAs.
  Genuine capability/topic search still dispatches agent-catalog-search (with the
  full catalog).

- f73a8fc: feat(dashboard): triage commitment chip + Cmd/Ctrl+Enter to send

  **Triage no longer promises prose-only work.** The `inbox-triage` prompt now
  forbids commitments like "I'll draft that for you in a few minutes" — every
  promise must either propose an `<actions>` entry that does the work, or
  honestly route the operator to the right tool when no agent can. When triage
  DOES propose an action, it also emits a short `commitmentSummary` string
  (e.g. "searching catalog for trivia agents") that the modal renders as a
  pulsing pill next to the status badge. The chip stays alive while any of
  the proposed actions are still in proposed/running state and clears once
  they all terminate. Plan-envelope schema, route parsing, and SSE
  `triage:complete` payload all carry the new field; existing replies without
  a `commitmentSummary` render exactly as before.

  **Cmd+Enter (Mac) / Ctrl+Enter (other) sends the reply.** A keydown delegate
  on the modal catches the shortcut inside any `textarea[name="body"]` and
  calls `form.requestSubmit()` on its enclosing `data-inbox-modal-form`. The
  Post reply button gains a `title="Cmd/Ctrl + Enter"` tooltip for
  discoverability. Plain Enter still inserts a newline.

  First layer of the triage follow-through plan
  (`~/.claude/plans/triage-follow-through.md`). Layers 2 (auto-approve trusted
  chain) and 3 (sub-agent completion re-invokes triage) close the rest of
  the "did you finish?" loop and ship as separate PRs.

- 945b236: feat(dashboard): cap consecutive auto-triage turns at 5

  Closes the runaway-loop risk Layer 2 introduced. The existing
  `maybeRefireTriage` (which already re-invokes triage after each
  sub-agent action resolves) now counts consecutive `triage` responses
  since the most recent `user` reply. When that count hits 5, instead of
  firing another triage turn we post a system note ("Auto-follow-up
  paused after 5 consecutive triage turns. Reply or dismiss to continue."),
  flip the thread to `awaiting_user`, and stop. The operator's next
  reply resets the counter so fresh user input always gets a fresh
  budget.

  Layer 3 of the triage follow-through plan
  (`~/.claude/plans/triage-follow-through.md`). The other half of Layer 3
  — passing sub-agent results to the follow-up triage turn — was already
  in place: `runTriageAgent`'s CONVERSATION snapshot includes each action's
  status and `resultSummary` (lines 1319-1328), so triage already sees
  what came back without any new input plumbing.

  Closes the "did you finish?" pain end-to-end:

  - Layer 1 (#411) — triage emits structured commitments; chip surfaces
    pending work in the modal header.
  - Layer 2 (#412) — trusted sub-agent proposals auto-approve to running.
  - Layer 3 (this) — sub-agent completion re-invokes triage to summarize,
    capped at 5 turns to prevent runaways.

- a387270: Inbox streaming: typewriter UI for triage replies.

  Plan path B, PR 4 of 4 — completes the streaming work. Triage's
  reply now paints into a live bubble as the LLM streams text,
  replacing the prior "wall of text materializes at LLM finish"
  moment with a ChatGPT-style incremental reveal.

  **Modal JS** (`packages/dashboard/src/views/inbox-modal.js.ts`)
  listens for three new SSE event types:

  - `triage:started` — creates a streaming bubble with the Tri avatar
    and a "Writing…" meta label. The server-rendered thinking
    indicator is removed so the operator doesn't see "Triage agent
    is thinking…" sitting above the live reply.
  - `triage:token` — appends `chunk` to the bubble's text. Chunks
    accumulate into a string queue and flush once per animation
    frame via `requestAnimationFrame` so a burst of tokens doesn't
    thrash layout. Uses `appendChild(createTextNode(...))` — never
    innerHTML — so any "<" or "&" in the model output renders as
    text, not markup. Auto-scrolls only when the operator was
    already near the bottom (preserves their reading position).
  - `triage:complete` — clears `data-streaming`, sets
    `data-settled="1"`. The blinking caret hides; the canonical
    fragment refresh that follows (via the existing onAnyEvent
    scheduler) replaces the bubble with the persisted entry,
    no flicker.

  **CSS** (`packages/dashboard/src/assets/screens.css`) adds the
  streaming caret — a black-vertical-rectangle pseudo-element after
  `.inbox-msg__text`, blinking at 900ms via `inbox-stream-caret`
  keyframes. Settled state hides it.

  Live-verified end-to-end: posted a reply, watched
  `bubble-text-len=582 streaming=true` at t=9s and
  `settled=true` at t=10s with the screenshot showing the bubble
  mid-write (avatar + "Writing…" meta + visible streamed text
  ending in `<plan>` `{`).

  1850 tests pass (no test changes — pure runtime behavior).

- fc32f65: Inbox queue: flat sortable list + right-side actions + activity-strip
  preview.

  PR 2 of 2 in the queue UX pass (PR 1 was #407: store-layer sort +
  last-activity). Replaces the priority-segmented layout with one
  flat list under a sticky sortable column header, reorders the row
  so star + chevron sit on the right next to the metadata they
  modify, and rebuilds the expanded preview as an activity strip
  showing the actual conversation signal.

  **Flat list.** Drops `renderGroup` and the priority-group cards.
  The priority dot stays on each row — that's the urgency cue at a
  glance. The (sorted) row order carries the rest.

  **Sticky sortable header.** Five column links — Priority · Title ·
  Agent · Status · Age — each render as a sort link that flips
  direction on click. The active column shows a `↑` / `↓` arrow;
  inactive columns are clickable but show no arrow. URL drives the
  sort state (`?sort=X&dir=Y`); active filters (`q` / `starred` /
  `tag`) are preserved through clicks. The chevron + star columns
  get no label.

  **Row layout reorder.** Operator feedback: "the grid row left side
  doesn't make sense - think it should be right side." Star and
  chevron move to the right. New grid template
  (`12px 1fr auto auto auto 24px 24px`): priority dot + title (+
  inline tags) on the left, agent · status · age · star · chevron
  on the right. Drops the `—` placeholder for missing agents —
  empty space reads as "no agent" without adding ink. The
  left-edge amber accent for `awaiting_user` stays.

  **Activity-strip preview** replaces the body-only excerpt:

  1. Latest non-action response (triage / user / system) with
     avatar + role + first ~160 chars (word-boundary truncation).
  2. Pending-actions summary chip when triage proposed actions:
     `▸ 1 proposed action: agent-catalog-search`.
  3. Context payload disclosure (only when present).
  4. Tag chips move from the title cell into the preview.
  5. Right-aligned footer: Open thread → · Source label.

  Empty cases: manual conversation with no replies shows an italic
  "No replies yet. Open the thread to start the conversation." with
  the Open thread CTA. The `(empty)` body sentinel from the store's
  NOT NULL workaround is suppressed (mirrors the modal's filter at
  inbox-detail.ts:135). Rows with no responses but a real body fall
  back to a body excerpt (~320 chars).

  **Route preview payload.** `GET /inbox` computes per-row
  `{latestResponse, proposedActions}` in one pass per row via
  `listResponses(m.id)` — cheap at the default ≤200 row page size.
  Walks responses from newest to oldest with an early exit once both
  signals are captured. If pagination grows the row count
  materially, fold into a bulk store helper that joins
  `inbox_responses` once.

  **Mobile fallback.** At <720px the priority + agent columns
  collapse on both the row and the sticky header. The chevron and
  star stay on the right so operators can still triage on phones.

  1873 tests pass (no behavior tests added — pure markup +
  ordering). Dogfooded live with `SUA_INBOX_DEMO=1`: flat list
  rendered, sort links navigated to the right URL with the right
  arrow indicator, activity-strip preview showed the system reply

  - proposed-action chip + Open thread footer.

- f403090: CSP-blocked images now show an inline "Allow this host" card on the tile.

  Building on #376 (which surfaces blocked hosts as pills on the agent
  config page), this PR closes the friction loop without forcing the user
  to navigate at all: when an `<img>` is blocked by the page CSP, a small
  themed card appears in place of the broken image with a `+ Allow <host>`
  button. Clicking it POSTs to `/agents/:id/permissions/allow-host`, adds
  the host to the agent's allowlist, and shows a Refresh button (the
  current page's CSP header is frozen for its lifetime, so a fresh
  document render is needed to pick up the new policy).

  Also fixes a latent bug in the existing CSP-violation listener
  (introduced in #376): for `img-src` violations Chrome sets `e.target`
  to `HTMLDocument`, not the offending `<img>` element, so
  `findOwningAgentId` never found the owning tile and nothing was ever
  reported in the wild. Now uses `e.blockedURI` to match against
  `<img>` `src` / `currentSrc` / `data-failed-src` to locate the
  element. Tests passed because they POST directly to the endpoint;
  the client capture wasn't actually firing until this fix.

  A tiny `securitypolicyviolation` buffer in `<head>` catches violations
  that fire during body parse, before the main script bundle at the end
  of `<body>` has registered its listener. The main listener drains the
  buffer on load.

- 57e08c4: Named dashboards: per-placement layout overrides.

  `DashboardSection` gains an optional `placements` map keyed by agent id —
  `{ size?, tileFit?, height? }`. The dashboard Improve-layout commit
  endpoint reads the planner's `topAgents` entries and writes per-section
  placements on the new layout, so two dashboards can size the same agent
  differently. The renderer applies placement on top of the agent-global
  `LayoutHintsStore` entry; any undefined placement field falls through to
  the hint, then to the agent's `signal.size` / `outputWidget.tileFit`,
  then to the renderer defaults.

  Backwards-compatible: existing dashboards without `placements` render
  exactly as before. Round-trips through the dashboard store.

- b924ade: Foundation for per-agent layout hints (size, tileFit, height).

  Adds a new `LayoutHintsStore` (SQLite-backed, decoupled from the
  versioned agent schema) and threads `suggestedTileFit` / `suggestedHeight`
  into the layout-plan schema. The Pulse renderer now reads hints through
  a fallback chain (`hint → signal/outputWidget → default`); no commit
  path writes hints yet, so this ships zero visible behaviour change.
  Later PRs teach the layout-planner agent to suggest tileFit/height and
  wire the Improve-layout wizard's commit endpoint to persist them.

- 1e8c77c: Improve-layout now persists per-tile size, tileFit, and height.

  The layout-planner agent is taught to emit `suggestedTileFit`
  (`grow` / `scroll`) and `suggestedHeight` (CSS pixels) alongside the
  existing `suggestedSize`. The Pulse "Apply" button forwards the
  planner's `topAgents` entries to the commit endpoint, which writes
  them into `LayoutHintsStore`. Pulse and named-dashboard renderers
  load hints in one batched lookup per page and let them override the
  agent's declared `signal.size` / `outputWidget.tileFit` defaults.
  Re-running Improve layout only overwrites fields the planner actually
  emitted — other hints are preserved.

  Named-dashboard per-placement overrides (so two dashboards can size the
  same agent differently) ship in a follow-up.

- 7661d89: fix(core): LLM waterfall now falls back on auth_required and rate_limited

  Pre-fix, the waterfall in `node-spawner.ts` only swapped providers on
  `binary_missing`, `timeout`, `quota_exceeded`, and `credit_exhausted`.
  A node pinned to claude with an expired session (`auth_required`) or a
  429 (`rate_limited`) returned a hard failure even when the operator
  had wired a multi-provider chain in `/settings/llm` — defeating the
  whole point of the waterfall.

  `shouldFallback` is now exported and returns true for those two
  additional categories. `other` stays excluded so unclassified errors
  still surface as real bugs instead of being silently masked by a
  provider swap. Five new unit tests cover the expanded policy.

- 11f7834: LLM fallback policy: when the primary provider fails with a
  recognized credit/quota/binary-missing/timeout error, node-spawner
  automatically retries the same prompt under a configured fallback
  provider. Operators configure both providers from a new
  `/settings/llm` page that also includes a Probe button for liveness
  checks and a "last fallback fired" status line.

  - New `LlmSettingsStore` (file-backed JSON at
    `data/.sua/llm-settings.json`) — `{ primary, fallback?, lastFallback? }`
  - New `classifyLlmFailure(SpawnResult)` buckets failures into
    `credit_exhausted | quota_exceeded | binary_missing | timeout |
rate_limited | auth_required | other`. Only the first four trigger
    a fallback; rate limits stay on the primary (transient), auth
    failures bubble up (operator action required), `other` is treated
    as a real bug we don't want to mask.
  - `spawnNodeReal` accepts an `llmSettings` snapshot in opts and
    retries with the fallback provider when applicable. The snapshot
    carries an `onFallback` callback that records telemetry back to
    the store so the settings page can show "fallback fired 3m ago on
    agent X because credit_exhausted."
  - `DagExecutorDeps.llmSettings` threads the snapshot through; every
    dashboard `executeAgentDag` call site (inbox, run-now, build,
    layout planners, widget-run, run-mutations) is wired up.
  - New `/settings/llm` route + view with primary/fallback dropdowns,
    Save button, Probe button (spawns each CLI with `--version`,
    reports reachable/failed inline), and a status panel for last
    fallback telemetry. New "LLM" tab in the settings shell nav.

  19 new tests covering store CRUD + the failure classifier.

- 7d308ec: Treat contract-violating LLM output as a fallback-worthy failure.

  A node can now declare an `outputContract` (`mustMatch` regex / `minChars`). When
  a 0-exit LLM result fails it — e.g. a weak fallback model returns no `<plan>`
  block — the provider waterfall now classifies it as a new fallback-worthy
  category `invalid_output` and escalates to the next (stronger) provider instead
  of accepting useless output. If every provider fails the contract, the run fails
  honestly instead of being a silent success. Opt-in: nodes without a contract are
  unaffected.

- 870aae9: Record and surface WHY each LLM provider was skipped in the fallback waterfall.

  When the LLM provider waterfall falls back (e.g. codex → apple-foundation-models),
  the per-attempt failure reason used to be discarded once a later provider
  succeeded. Each failed attempt is now captured (`{provider, category, error}`),
  persisted on the node execution (`provider_failures_json`), and logged to stderr
  (`[llm-fallback] agent/node: codex failed (timeout): …`). The run-detail node
  card now reads "ran on apple-foundation-models · codex (timeout) failed" with the
  full error in the hover, instead of a bare "codex failed".

- 71510dd: LLM provider waterfall + pinned-provider fallback fix.

  The previous one-primary + one-fallback model bricked runs in two
  common scenarios: (a) an agent or node pinned to a single provider
  (e.g. `provider: claude`) silently disabled fallback so any CLI
  outage took the run down with it; (b) the chain stopped after one
  hop even when more providers were available.

  Replaces both with an ordered waterfall.

  **Schema.** `LlmSettings.providers: LlmProvider[]` (ordered;
  `providers[0]` is the primary). The old `{ primary, fallback? }`
  shape is auto-migrated on first read. Empty chains are rejected — at
  least one provider must remain so every llm-prompt node has
  something to dispatch to.

  **Waterfall.** `spawnNodeReal` now builds a chain via the new
  `buildProviderChain(pinnedProvider, configuredOrder)` helper: the
  node's pinned provider (if any) goes first, then the configured
  global order follows, deduplicated. The loop walks the chain in
  order; on classified failures (credit / quota / binary-missing /
  hard-timeout) it advances to the next provider, fires per-hop
  telemetry, and continues. Rate-limit / auth / other errors still
  short-circuit the chain.

  **Telemetry.** `NodeExecutionRecord` gains `usedProvider` (the
  provider that actually produced the result) and `attemptedProviders`
  (CSV trail in order). The run detail page surfaces a "ran on codex ·
  claude failed" chip on node rows whenever the trail has more than
  one entry. `LlmSettingsSnapshot.onFallback` now fires once per hop
  with `from`/`to` instead of a single primary/fallback callback.

  **Dashboard `/settings/llm`.** Replaces the primary + fallback
  dropdowns with an ordered chain UI: rank, provider id + label,
  Primary/Fallback chip, Up/Down/Remove per row, plus an "Add
  provider" dropdown when not all known providers are in the chain.
  Routes split into `POST /settings/llm/add`, `/remove`, `/move`.

  **Tests.** New unit tests for `buildProviderChain` (5 cases
  covering: configured order with no pin, pin biases head, dedup, no
  config defaults to claude, pin survives empty config, three-provider
  order). Store tests rewritten for the new API plus three migration
  cases (v1 → v2, v1-without-fallback, v1 lastFallback preservation)
  and two defensive-parse cases for hand-edited v2 files.

- d8176e6: fix(mcp): expose dashboard-managed (v2) agents alongside filesystem (v1) agents

  `list-agents` only ever returned a single agent because the MCP server
  reads agents from filesystem YAML directories (`loadAgents`). Every
  dashboard-managed agent lives in the SQLite agent store (DB), not on
  disk, so they were all invisible to MCP regardless of their `mcp:
true` flag.

  This PR makes the MCP server consult both sources:

  - **AgentStore (v2, DB)** is the canonical source for dashboard-managed
    agents. Filter: `mcp = true` AND `status = active`.
  - **Filesystem (v1, legacy)** still works for pre-DB YAML files. DB
    entries win on id collision.
  - `loadMcpExposedAgents` now takes an options bag (`{ agentStore,
agentDirs }`) and returns a discriminated `McpAgentEntry` so the
    `run-agent` tool can dispatch v2 agents through `executeAgentDag`
    and v1 agents through the existing `provider.submitRun` path.
  - `startMcpServer` opens dedicated `AgentStore` + `RunStore` +
    `VariablesStore` handles against the same SQLite DB (safe under
    WAL, same pattern the dashboard + scheduler already use).
  - `list-agents` JSON output gains a `source: "v2" | "v1"` field so
    callers can distinguish dashboard-managed from filesystem-loaded.

  The `run-agent` tool now successfully starts v2 agents from MCP. Run
  results come back synchronously (v1 path) or wait for the DAG
  executor to complete and return the run summary (v2 path).

- e127cb9: feat(dashboard): node-discovery picklist on the add-node form

  Closes the "node discovery for flow building" item from
  `memory/project_next_features.md`: previously the add-node form
  showed 5 hardcoded quick-start patterns and a flat dropdown of
  every built-in tool, user tool, and invocable agent mixed together.
  Operators had to know what each entry did before they could pick.

  A new "Discover nodes…" button next to the Quick start patterns
  opens a search-driven picklist modal grouped by source:

  - **Quick patterns** — the existing `NODE_PATTERNS` set with
    pre-filled defaults
  - **Built-in tools** — `shell-exec`, `http-get`, `http-post`,
    `file-read`, `file-write`, `json-parse`, `json-path`,
    `template`, `csv-to-chart-json`, `llm-prompt`
  - **User tools** — agent-defined tools from the `toolStore`
  - **Invocable agents** — other installed agents (current agent
    excluded; active only)

  Each card shows name + description + the source-group chip + the
  toolId in mono. Search filters by name / description / id; group
  headers hide when all their cards are filtered out. Click a card →
  sets the existing `#node-tool-select` dropdown, dispatches change
  so the dynamic toolInput section re-renders, and pre-fills any
  declared defaults (for pattern cards). Click outside / press Esc /
  hit the × closes.

  Wiring:

  - New `views/node-discovery-modal.ts` builds the entries +
    renders the modal scaffold + cards.
  - New `views/node-discovery.js.ts` carries the open/filter/select
    client JS, added to the layout's bundled-scripts string.
  - `views/agent-add-node.ts` mounts the button next to the existing
    pattern strip and the modal at the end of the page body.
  - New CSS for the modal in `components.css` keyed off
    `.node-discovery__*`.

- 9e6a669: Pulse + dashboards: masonry-style packing eliminates grid voids.

  The 4-column Pulse grid used to lock every row's height to its tallest
  tile (with `align-items: start`), turning the space below shorter tiles
  into voids that belonged to the short tile's own grid cell —
  undrop-targetable, unfillable, visually ugly. Dragging a tile into a
  visual gap would either rearrange the layout or reject the drop.

  The grid now declares `grid-auto-rows: 8px` + `grid-auto-flow: dense`,
  and a small JS module (`pulse-masonry.js.ts`) computes `grid-row: span N`
  per tile from its rendered height. A 200px tile takes ~9 row-units, an
  1115px tile takes ~48. Columns pack independently (Pinterest-style),
  no voids. ResizeObserver re-packs on content height changes (image
  load, widget body swap, manual resize). MutationObserver re-packs when
  tiles are added/removed via drag-drop or planner Apply. Window resize
  also triggers a re-pack.

  `.pulse-tile--1x2` and `.pulse-tile--2x2` no longer declare
  `grid-row: span 2` — the row-span is computed. Their `max-height: 600px`
  cap is preserved so the planner's wide-and-tall intent still means a
  ceiling on height. Applies to named-dashboard `.pulse-grid` instances
  too — same packer, same triggers.

- 3e12b1d: Promote Scheduled to a top-level nav entry.

  The header now reads sua | Pulse | **Scheduled** | Agents | Settings |
  Help. `/scheduled` previously lived as a sub-tab under Agents, which
  made it hard to find — it carries cross-agent state (paused agents,
  next-run timing) that doesn't fit the per-building-block grouping.
  Dropping it from the Agents tab strip; promoting to global nav.

- d7914e8: Make the DAG node-spawn seam pluggable for alternate execution backends.

  `SpawnNodeFn` now receives the same `onProgress` / `signal` / `onSpawn`
  callbacks the in-process spawner gets, and `SpawnResult` carries an optional
  `usedWorkflowProvider` a backend self-reports. The executor copies that onto the
  node execution row and rolls it up to the run. This is the seam a Temporal-
  backed node executor plugs into; behavior is unchanged for the default
  in-process path.

- 810141a: Fix the "View in Temporal" deep link (no more 404).

  Durable per-run executions now persist their Temporal execution runId
  (`temporal_run_id`), so the run-detail "View in Temporal" link points at the
  real history page (`/workflows/sua-run-<id>/<runId>/history`) instead of a bare
  workflow id that 404s. Per-node Temporal runs (e.g. inbox-dispatched agents,
  which have no single run-level workflow) now land on the namespace's workflows
  list rather than a guessed `sua-run-<id>` that doesn't exist.

- 0059585: Durable v2 DAG runs on Temporal (provider layer).

  The Temporal provider gains `submitDagRun`, which runs a whole v2 DAG as one
  durable `sua-run-<id>` workflow: a long worker activity (`runDagActivity`) runs
  the existing executor against the shared store. If the worker crashes, Temporal
  re-dispatches the activity and it resumes the run from the last completed node
  (via `resume`). A failed agent returns normally and does NOT retry — only an
  infra crash re-dispatches. Not yet wired into the dashboard run paths (next PR).

- f3c4dd1: Failed Temporal runs raise an inbox conversation.

  A run that fails on a Temporal worker — or one orphaned because the dashboard
  died mid-run — now opens a `run-failure` thread in the dashboard inbox (one per
  run, deduped) so the triage agent notices instead of the failure dying silently.
  Local in-process failures don't raise one (they're visible to whoever triggered
  them) and operator-cancelled runs never do. The executor exposes a decoupled
  `onRunFailure` hook; the dashboard wires it (and covers boot-time orphan-reaped
  runs).

- df79938: Live progress for v2 DAG nodes running on Temporal.

  The node activity now heartbeats its full progress trail, and the dashboard-side
  spawnNode polls the workflow and re-broadcasts new progress events through the
  normal `onProgress` path — so `node_executions.progressJson` and the inbox
  "thinking…" token stream update for Temporal runs, at ~1s granularity. Final
  sub-second progress may be dropped; the run result is always captured.

- dd0e5cb: Run v2 DAG nodes on Temporal workers.

  When the dashboard is started with `--provider temporal`, multi-node (v2 DAG)
  agents now execute each node as a Temporal worker activity (one
  `sua-node-<runId>-<nodeId>` workflow per node) instead of in-process. The
  dashboard still orchestrates the DAG; node shell/LLM work is offloaded to the
  worker, made cancellable (the activity heartbeats), and shown in the Temporal
  UI. Runs and node executions are stamped `usedWorkflowProvider`.

  Declared secrets are read on the worker from the secrets file and never travel
  in the Temporal activity payload; non-declared sensitive env values are dropped
  before crossing to the worker (a payload-encryption codec to lift that is a
  planned follow-up). Durable whole-DAG-as-workflow orchestration is the next step.

- be68e97: Dashboard and MCP server honor the configured run provider.

  `sua dashboard start` and `sua mcp start` now accept `--provider <local|temporal>`
  (also respecting `SUA_PROVIDER` and `sua.config.json`) and route "Run now" /
  run-submission through that provider instead of always using the local one. The
  selected provider is shown in the startup banner, and an unreachable Temporal
  server fails fast with a clear hint instead of hanging. New operator guide at
  `docs/temporal.md` covers running Temporal in Docker and monitoring it via the
  Temporal Web UI.

  Note: this routes v1 single-node agents through Temporal; multi-node (v2 DAG)
  agents still run in-process. Executing v2 DAGs on Temporal is planned next.

- 10dad23: Route run-now through durable Temporal runs, with a per-agent backend control.

  Under `--provider temporal`, a v2 agent's run-now now submits a durable
  `sua-run-<id>` workflow (crash-survivable, resumes from the last completed node)
  instead of running in-process. A new per-agent `runOn` field (Agent config →
  "Execution backend": local / temporal / default) decides: `local` opts out,
  `temporal` or unset runs durably under a Temporal provider. Non-temporal
  providers always run local. Inline sub-flows stay in-process.

  This completes the B2 line: v2 DAG runs are durable end to end.

- 0589dfc: Manage the Temporal worker as a first-class service.

  The Temporal worker is now a managed `sua daemon` service: add `worker` to
  `daemon.services` or run `sua daemon start --service worker`. When
  `provider: temporal` is configured, `sua daemon start` also passes
  `--provider temporal` to the dashboard + MCP server so the whole stack agrees.
  New `scripts/temporal-up.sh` / `temporal-down.sh` bring the entire stack
  (Temporal server + dashboard + MCP + worker) up and down in one command.

  A new **Settings → Temporal** page shows the active run provider, the Temporal
  connection (address / namespace / task queue), and the worker's status with
  Start / Stop controls (managing the same daemon-tracked worker — the worker
  still runs on the host, never inside the web process).

- c16e607: feat(dashboard,examples): triage dispatches agent-builder with auto-injected catalogs

  Closes the gap flagged in PR #411: when the operator asks triage to
  "build me an X agent" and no installed agent matches a prior catalog-
  search, triage now proposes an `agent-builder` action instead of
  telling the operator to run `/build` themselves.

  ### What landed

  - `agent-builder` is now in `TRIAGE_SUB_AGENT_ALLOWLIST`,
    `TRIAGE_AUTO_APPROVE_AGENTS`, and `SYSTEM_AGENT_IDS`. The proposal
    auto-runs on emit (no operator click), the commitment chip pulses
    through the run, and catalog-search hides it from results so it
    isn't recommended as a generic match.
  - New `enrichAgentBuilderInputs` helper in `routes/inbox.ts` injects
    `AVAILABLE_TOOLS` (formatted tool catalog) + `DISCOVERY_CATALOG`
    (built via `buildDiscoveryCatalog` from agent + tool + template +
    dashboard + pack stores). Mirrors the `/agents/new` "Build from
    goal" flow's input shape so triage-dispatched builds see the same
    context as the dashboard button path.
  - `inbox-triage.yaml` prompt now documents `agent-builder` under the
    Agent guide:
    - Pass `GOAL` verbatim from the operator's request.
    - `FOCUS` is opt-in for genuine constraints only.
    - Auto-injection is called out so triage doesn't try to thread the
      catalogs through `inputs`.
    - Order-of-operations rule: propose `agent-catalog-search` FIRST
      when the operator names a topic, then propose `agent-builder`
      only after a confirmed miss (or when the operator explicitly
      asked for a fresh build).
  - Added an `agent-builder` example to the OUTPUT FORMAT block with
    the right `commitmentSummary` shape ("drafting trivia-night
    agent").

  After restart, triage stops bouncing operators to `/build` for
  "build me an agent" requests — Layer 2 auto-approves the proposal,
  the chip pulses while it runs, and Layer 3 wraps with a summary the
  operator can act on.

- 01731d6: feat(dashboard,examples): inbox triage honors a provider hint when dispatching agent-builder

  When the operator says "build it on apple" (or names any provider in
  the conversation), the inbox-triage prompt now emits an optional
  `PROVIDER` field in the action's `inputs` map. The route extracts it
  as a provider pin, strips it from the agent inputs (so input-
  resolution doesn't reject an undeclared key), and applies the pin to
  every llm-prompt node in the agent-builder agent via the
  `applyProviderPin` helper exported from build-orchestrator.

  Mirrors PR #422's "Build from goal" provider picker but driven from
  the conversation instead of a UI control. The global fallback chain
  in `/settings/llm` still applies on classified failures — the pin
  says "try this first," not "use only this."

  Triage prompt updates:

  - Maps loose phrasings: "apple" / "on-device" / "foundation models"
    → `apple-foundation-models`; "claude" → `claude`; "codex" /
    "openai" → `codex`.
  - Hard rule: omit `PROVIDER` entirely when the operator didn't name
    a provider. Never invent the hint.
  - New OUTPUT FORMAT example shows the shape.

  The validator drops PROVIDER if the operator didn't supply one or if
  the value isn't in `LLM_PROVIDERS`, so a malformed hint silently
  falls back to the system default chain.

- f927ac5: feat(dashboard): concurrent-triage guard — one in-flight turn per thread + don't auto-fire on pending actions

  Plan item #4 from
  `~/.claude/plans/triage-followups-2026-05-30.md`. Two races closed:

  **(a) Two triage runs racing on the same thread.** When triage was
  already running and an operator reply arrived (or a sibling tab hit
  `/triage`), `runTriageAgent` happily started a second run. Two replies
  would land out-of-order; message-status updates raced.

  `runTriageAgent` now checks `ctx.inboxTriageAbortControllers.has(messageId)`
  at the top and defers re-entry by adding the message to a new
  `ctx.inboxTriagePendingRefires` Set. The in-flight run's `finally`
  block drains the pending refire via `setImmediate` after clearing
  its own controller — so the operator's reply still gets a triage
  turn, just sequential instead of concurrent. The drain is gated on
  `!signal.aborted` so operator-cancelled runs don't auto-restart.

  **(b) Triage auto-firing while a proposed action is pending.** When
  triage proposed an action and the operator replied before the action
  ran, `POST /inbox/:id/respond` would auto-fire triage anyway —
  triage would then propose ANOTHER action or comment on the pending
  one. The action also might auto-approve and run concurrently with
  the fresh triage turn.

  `POST /respond` now skips the auto-fire when any action on the
  thread is in `proposed` or `running` state. The user reply is still
  recorded; the post-action `maybeRefireTriage` (which fires when all
  actions resolve) gives triage the full picture in one turn instead
  of two. Operator can still hit "Ask triage" explicitly to force a
  turn.

  **Set membership is idempotent** — N stacked re-entries collapse to
  one queued refire. The in-flight run only sees CONVERSATION as of
  its start time, so the queued refire ensures every reply gets a
  response.

  Tests: 4 new route tests cover (a)+(b). Full suite: 1839 passing.

- 2263802: inbox-triage: direct-voice prompt + stronger catalog-search trigger.

  The triage `recommendation` is rendered verbatim in the conversation
  thread, but the model sometimes emitted stage directions instead of
  the actual message — e.g. "Reply with a clarifying question before
  routing: ask whether they want…" or "shortlist request: ask what
  platform or directory they want the existing trivia agent from"
  instead of just asking the question or proposing the catalog search.

  Adds a VOICE section near the top of the prompt with bad-vs-good
  examples (first-person direct reply, no meta-narration about
  routing/shortlisting) and two new OUTPUT FORMAT examples: a
  clarifying question done right, and a catalog-search proposal for a
  concrete topic.

  Also strengthens the agent guide for `agent-catalog-search` (shipped
  in #393) so the model proposes it DIRECTLY when the operator names a
  topic ("trivia", "cocktail", "weather"), without first asking which
  platform or directory — the installed catalog IS the directory.

- 05d5549: Inbox triage: auto-refresh stale allowlist agents + clear error when dispatch target is missing.

  Two compounding bugs that broke the analyzer dispatch path shipped
  in #397:

  1. **Stale system allowlist agents.** The auto-import in
     `getSubAgentAllowlist` only fired when an allowlist agent
     (analyzer / editor / catalog-search) wasn't installed at all —
     never when the bundled YAML on disk had changed since install.
     Operators who installed `agent-analyzer` before PR #394 still had
     the pre-preflight version (`AGENT_YAML: required: true`, no
     preflight node) and any dispatch died at input resolution with a
     generic "Missing required input AGENT_YAML" — looking like an
     analyzer bug rather than a stale-install issue. Now compares the
     installed exported YAML against the bundled file and re-imports
     when they differ. Scoped to allowlist entries only; user agents
     are never touched.

  2. **Silent enrichment when target agent is missing.** When the
     inbox message referenced an agent that wasn't installed (e.g. a
     permission-request for `demo-astro-tile` on a fresh catalog),
     `enrichAgentAnalyzerInputs` silently left `AGENT_YAML` empty and
     the analyzer dispatch went through anyway — surfacing the same
     confusing "missing required input" rather than the real cause.
     Now the route refuses the dispatch upfront, sets the action card
     to failed with a clear refusalReason, and posts a system response
     to the conversation: "Can't dispatch agent-analyzer — the target
     agent <id> is not installed in this catalog."

- aded19a: feat(dashboard): stop button on the triage thinking indicator

  While triage is in flight, the modal's "Triage agent is thinking…"
  indicator now ships with a square stop button on the right edge.
  Clicking it aborts the underlying DAG run, kills any spawned LLM
  processes, marks the run cancelled, posts a system note ("Triage
  stopped by operator."), and re-enables the composer so the operator
  can send a new message immediately.

  Implementation:

  - New `inboxTriageAbortControllers: Map<messageId, { runId, controller }>`
    on `DashboardContext`. `runTriageAgent` now pre-generates the runId
    (via `randomUUID`), creates an `AbortController`, registers in both
    `activeRuns` (by runId) and `inboxTriageAbortControllers` (by
    messageId), and passes the abort signal into `executeAgentDag`.
    Cleared on completion in a `finally` block so even crashes don't
    leave stale entries.
  - New `POST /inbox/:id/triage/cancel` route: looks up the controller
    by message id, aborts it, calls `provider.cancelRun` as belt-and-
    suspenders, and force-finalizes the run + node executions if the
    executor didn't get to its own teardown before the response. Idempotent
    — missing entries (run already finished, dashboard restarted)
    return 204 with "Nothing to cancel."
  - View update in `inbox-detail.ts`: the thinking indicator now
    contains a `<form data-inbox-modal-form>` posting to the cancel
    route. Reuses the modal's existing submit interceptor so the
    fragment refresh after cancel is the same path tags / star / reply
    already use.
  - New `.inbox-thinking__stop` CSS: 28×28 square with a small filled
    square icon, hover state, sits at the end of the thinking row.
  - 3 new route tests: abort + cleanup (entries removed, run flipped to
    cancelled, system note inserted), idempotent no-op on a thread
    with no in-flight triage, 404 on unknown id.

- 82f8f30: Inbox typewriter: strip the `<plan>` envelope from the streamed
  bubble so the operator sees only the recommendation text.

  The triage agent's stream is the raw plan envelope
  (`<plan>{"messageId":"…","recommendation":"…","actions":…}</plan>`).
  The canonical persisted entry (post-`extractPlanJson`) shows only
  the `recommendation` value, but the streaming bubble was showing
  the raw envelope for the few seconds between `triage:token` arriving
  and the canonical fragment refresh swapping in.

  Fix: accumulate the full token buffer per turn, then on each
  animation-frame tick try to extract just the `recommendation`
  value (handles escaped chars including `\"`, `\\`, `\n`, `\t`,
  `\uXXXX`). Returns whatever partial value has been streamed up to
  the cursor, so the typewriter still paints incrementally. Falls
  back to the raw streamed text when the recommendation key hasn't
  arrived yet (envelope preamble) so non-plan responses still show
  something useful. Buffer resets on each new `triage:started`.

  Verified the parser correctness via five-case inline trace:

  - Full plan → recommendation text only
  - Mid-stream (no closing quote yet) → partial value as buffered
  - Early stream (no recommendation key yet) → null → caller falls
    back to raw streamed text
  - Escaped quote / newline → render as literal characters

- bf2c73a: Record which execution backend ran each run.

  Runs and node executions now carry a `usedWorkflowProvider` field
  (`local` | `temporal`) so you can tell where work actually ran. This is a
  distinct axis from the LLM provider (`usedProvider`, claude/codex/apple). The
  local and Temporal providers stamp it at submit time; v2 DAG runs record
  `local`. The runs list shows a `temporal` chip for Temporal runs and the run
  detail page shows a Backend row. Legacy rows read back as local.

- 0e378e3: Validate that shell `$UPSTREAM_<NODE>_RESULT` references point at a declared dependency.

  The executor only injects an upstream node's output as `$UPSTREAM_<NODE>_RESULT`
  for DIRECT `dependsOn` edges. A shell command that reads a transitive ancestor's
  output gets an unbound variable — which crashes the node under `set -u` (and
  silently yields empty output without it). This was a recurring LLM-codegen bug:
  agent-builder would wire a command to an ancestor it forgot to depend on, and the
  schema check only caught the `{{upstream.X}}` template form, not the shell env-var
  form.

  Agent schema validation now flags a `$UPSTREAM_<NODE>_RESULT` (or
  `${UPSTREAM_<NODE>_RESULT}`) reference whose node isn't a declared dependency (or
  doesn't exist), while leaving safe defaulted forms `${UPSTREAM_X_RESULT:-…}` alone.
  Because agent-builder's `validate` node runs this check, the builder's `fix` step
  now self-corrects this class of bug. Also fixes the bundled `conditional-router`
  example, which had exactly this latent bug (an empty "TECH ALERT:" output).

- b235bec: Output widgets: copy-to-clipboard and save-as-PNG controls.

  Two new opt-in widget control types an agent can declare on its `outputWidget`:

  - `copy` — a copy button (Material content_copy glyph + tooltip) that copies the
    rendered widget text to the clipboard.
  - `capture-image` — a button that rasterizes the widget to a PNG and downloads it
    (html2canvas, vendored locally and lazy-loaded; CSP blocks CDN scripts). Optional
    `filename`. Note: external images that don't send CORS headers may capture blank —
    a browser security limit, surfaced as a clear message rather than a blank PNG.

  Both are stateless, so they render in static contexts too (inbox inline widgets,
  pulse/home tiles) — not just the run/agent detail pages. Configurable from the
  output-widget editor's Controls section.

### Patch Changes

- e86bcd3: fix(core): apple-foundation-models spawner uses ESM import, not CJS require

  `appleFoundationModelsSpawner.resolveBinary` called `require()` to
  lazily load the runner module. The core package is ESM — `require`
  isn't defined at runtime — so every invocation of the Apple FM
  provider threw `ReferenceError: require is not defined` before
  reaching the runner. Replaced with a static top-of-file
  `import { ensureAppleRunner } from './apple-foundationmodels-runner.js'`.

  The "lazy load to keep the cold-path light on non-macOS hosts"
  justification didn't hold up — the runner module imports only
  Node built-ins (child_process, crypto, fs, os, path) that core
  already loads transitively. Eager-loading costs nothing.

- d81715d: Fix dashboard hanging on SIGTERM/SIGINT.

  The dashboard's graceful shutdown called `server.close()`, which only stops
  accepting new connections and waits for existing ones to drain. The inbox SSE
  stream and the 2s poll keep-alives never close on their own, so shutdown hung
  forever and the process became a zombie squatting on the port — surfacing as
  recurring "dashboard crashed on startup" (EADDRINUSE) errors. Shutdown now
  pairs `server.close()` with `server.closeAllConnections()` (Node 18.2+) to
  force-terminate the lingering sockets, so the dashboard stops promptly.

- 535314d: Require a structured output block from triage + catalog-search.

  The `inbox-triage` and `agent-catalog-search` system agents now declare an
  `outputContract` (`<plan>` / `<matches>`). If a provider returns 0-exit output
  without the required block — e.g. a weak fallback model that ignores the
  format — the waterfall escalates to a stronger provider instead of accepting it,
  and only fails the run if every provider whiffs.

- dba970d: Inbox: agents built from a thread are now real, runnable, and honestly reported.

  When triage built a new agent (e.g. "make me a random XKCD viewer"), the build
  ran but nothing committed it — `agent-builder` only designs and validates YAML,
  and the inbox action path skipped the commit the dashboard wizard does. The
  agent existed only as text in the run output, so `/agents/<id>` 404'd and triage
  would still claim it was "drafted" and link a dead URL.

  Three fixes:

  - **Auto-commit built agents (as drafts).** When an `agent-builder` action
    completes, the validated YAML is parsed and committed to the catalog as a
    draft (visible + runnable on demand, not live/scheduled until reviewed). A real
    `/agents/<id>` link is posted once it lands. An existing non-draft agent of the
    same id is never overwritten.
  - **No more fabricated links.** Triage `/agents/<id>` links are dropped unless the
    agent actually exists in the store, and the triage prompt no longer claims an
    agent exists before the system confirms the commit.
  - **Run what you just built, inline.** Agents built earlier in a thread become
    proposable, so triage can run them and stream output inline — gated on operator
    approval (they are not auto-approved).

- bf40edf: Fix inbox-built agents rendering literal `{ {outputs.X}}` in their widget.

  The template pipeline escapes `{{` → `{ {` to prevent re-expansion. The dashboard
  build wizard repairs this before committing (via `autoFixYaml`), but the inbox
  auto-commit path (agent built from a thread) skipped that repair, so the escaped
  form was persisted and the output widget rendered a literal `{ {outputs.X}}`. The
  inbox commit path now runs the same `autoFixYaml` repair the wizard does.

- 1cfa4ee: Inbox: fix the "Enable & run" grant note reading as if the run is still pending.

  The approve-to-run grant note said "Granted X… Running it now…", but it's posted
  after the action card (proposed earlier), so it renders below the already-finished
  run result. "Running it now…" then misled both the operator and the follow-up
  triage turn ("the run was just started, wait for the result") even when the run
  had already completed or failed. The note now states only the durable fact —
  "Enabled X to run from inbox threads — revoke in its Config tab" — and the action
  card remains the source of truth for the run's outcome.

- 1ab7d5f: Polish inbox links and modal scrollbar.

  Auto-linked `/agents/<id>` and `/runs/<id>` references now show the id as the
  link label (not the raw path), and all links in inbox messages and triage CTAs
  open in a new tab so following one keeps the inbox open. The modal's scroll
  container gets a thin, muted scrollbar instead of the heavy default slab.

- 9d728dc: fix(dashboard): escape backslashes inside INBOX_MODAL_JS template literal

  PR #409's `extractRecommendationFromStream` used un-doubled backslash escapes
  (`'\\'`, `'\n'`, `\s`) inside the `INBOX_MODAL_JS` backtick template literal.
  Template processing collapsed each `\\` → `\` at module-load time, producing
  invalid served JavaScript: `'\'` was an unterminated string and `'\n'`/`'\t'`/
  `'\r'` placed literal control characters inside single-quoted strings. The
  browser threw a parse error during the inline IIFE, so every click delegate
  in the inbox modal layer silently failed to attach — chevron toggle, row →
  modal click, rail collapse, suggest banner, copy button, new conversation,
  modal close.

  Doubled the backslashes in source so they survive template processing and
  produce valid JS in the served output. No behavior change to the parser
  itself.

- 139efbb: Fix inbox thread not updating when triage finishes with an error.

  Several triage completion branches ("did not complete", "no <plan>", "malformed
  JSON") added a system message to the conversation without emitting the
  `message:created` SSE event, so an open thread didn't refresh and the operator
  had to reload the page to see it. All triage system messages now route through a
  helper that always publishes the event, so the thread updates live.

- ebff232: Fix two issues found dogfooding the inbox-triage action loop in-browser.

  - **Triage hit max-turns**: with `maxTurns: 1` and no tool-use policy
    in the prompt, the LLM probed the filesystem (Bash + Read + Glob)
    before responding and timed out. Tightened the prompt with an
    explicit "do not use Bash/Read/Grep/Glob; the inputs are
    authoritative" instruction and bumped `maxTurns` to 2 as a safety
    buffer.

  - **AGENT_YAML enrichment silently no-op'd in the demo**: the inbox
    demo seed referenced `agentId: demo-failing-agent` but no such
    agent was installed. The route's enrichment skipped (correctly),
    leaving `agent-analyzer` to fail with "Missing required input
    AGENT_YAML". The demo seed now installs a stub `demo-failing-agent`
    YAML that intentionally references `shell-exec` (matches the demo
    message body "shell-exec: command not found") so the analyzer has
    a real failure to diagnose.

  Verified end-to-end: triage proposes the action card, operator clicks
  Run, agent-analyzer runs with auto-injected AGENT_YAML + LAST_RUN_OUTPUT,
  result lands in the thread, triage re-fires for a summary turn.

- 6145ffe: Pin all dependencies to exact versions.

  Every external dependency across the workspace is now pinned to an exact version
  (no `^`/`~` ranges), matching what was already installed in the lockfile. This
  makes installs fully reproducible and removes silent range-drift. Dependabot is
  configured to open weekly review-able PRs (grouped minor/patch, individual
  majors) so new releases are a deliberate decision rather than an automatic pull.

- c23e826: Link a run to its Temporal workflow.

  The run detail page's Backend row now shows a "View in Temporal ↗" deep link for
  runs that executed on Temporal, opening the run's `sua-run-<id>` workflow in the
  Temporal Web UI (honoring the configured namespace). Local runs are unaffected.

- d2660ca: Guard SQLite stores against startup lock contention.

  Stores set `PRAGMA journal_mode = WAL` but never a busy timeout, so `node:sqlite`
  raised `database is locked` the instant it couldn't grab a lock. When the daemon
  restarts the schedule, worker, and dashboard services at once they race to open
  the same DB file, and one would crash on startup ("Could not start the temporal
  provider: database is locked"). Stores now open through a shared `openStoreDb`
  helper that applies `PRAGMA busy_timeout` (5s), so SQLite waits and retries
  instead of failing. Behavior-preserving in the uncontended case.

- 28cc824: Fix Temporal node runs dying on a false heartbeat timeout.

  `runNodeActivity` only heartbeated when a node emitted a progress event, with a
  30s heartbeat timeout and no keepalive. An LLM node that thinks for longer than
  30s before its first streamed token (e.g. agent-builder's `design` step,
  inbox-triage's `triage` step) went silent, so Temporal killed the activity with
  "activity Heartbeat timeout" even though the child process was working fine — the
  run was recorded as a generic "Temporal node workflow failed: Workflow execution
  failed". A keepalive heartbeat now fires every 10s while the node runs, matching
  the whole-DAG activity.

  Also unwrap the underlying cause when a node workflow fails: the dashboard now
  surfaces the real reason (the activity error or heartbeat timeout) instead of
  Temporal's boilerplate "Workflow execution failed".

- d1433bc: fix(dashboard): triage stop button no longer double-posts an unfriendly "did not complete" note

  Race after PR #425: the cancel route posted "Triage stopped by
  operator." and force-finalized the run, but `runTriageAgent`'s
  continuation kept running and saw the executor's terminal status
  (either `'failed'` or `'cancelled'` depending on who won the race to
  update the row). It then added a second, scary system message like
  `Triage agent did not complete (failed). Failed at node "triage"
(timeout)`. Operator saw two messages back-to-back, the second
  implying something broke when nothing did.

  `runTriageAgent` now short-circuits both the continuation AND the
  catch-block whenever `abortController.signal.aborted` is set — that
  bit is the load-bearing operator-intent signal regardless of which
  status the run row ended up at. Also added a defensive
  `run?.status === 'cancelled'` check for the rare case where a
  sibling tab hit `POST /runs/:id/cancel` while triage was waiting.

  The cancel-route system message was also reworded from "Triage
  stopped by operator." to "Triage agent cancelled." per the
  operator's preference.

- aef466f: Rename the LLM-provider field to usedLLMProvider for clarity.

  `SpawnResult.usedProvider` and `NodeExecutionRecord.usedProvider` are renamed to
  `usedLLMProvider`, so the LLM-provider axis (claude/codex/apple) reads clearly
  next to the execution-backend axis (`usedWorkflowProvider`, local/temporal). The
  SQLite column stays named `usedProvider` (mapped in the run store), so there's no
  migration and existing data is untouched.

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

- bd5f9f7: Scheduled agents fire their first window on daemon start, even with no prior `triggered_by='schedule'` run.

  Freshly registered scheduled agents used to silently skip their first window: `hasMissedFire(expr, undefined)` returned `false` for any agent that had never fired on schedule before, so the daemon's start-up catch-up logic skipped them. Manual fires (`triggered_by='cli'|'dashboard'`) didn't count toward seeding. Net effect: installing `daily-greeting` at 10 AM and starting the daemon meant nothing fired until 8 AM **the next day** — and only then because that fire seeded the catch-up for future windows.

  Now: when `since` is undefined, catch up if the most recent past cron tick is within the past 24 hours. Daily/hourly/sub-day crons fire on first daemon start as users expect. Weekly/monthly/yearly crons whose most recent tick is older than 24h aren't surprise-fired on daemon restart.

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

- 5a98732: Tool-policies PR B: file shape, loader, executor seam (always-allow stub).

  Defines the on-disk schema for `.sua/policies.json` (`version: 1`, `defaultAction`, `rules[]`) plus `loadPolicyDocument(dataDir)` which reads the file when present and returns the default allow-all document otherwise. Malformed JSON or schema-invalid files throw `PolicyLoadError` rather than falling back silently — operators want a loud failure on configuration bugs.

  The dag-executor now runs every tool dispatch through `evaluatePolicy()` before calling `tool.execute()`. **No behaviour change today**: the function is a stub that always returns `{effect: 'allow'}`. PR C drops in real glob matching + condition evaluation here without touching downstream dispatch.

  New `'policy_denied'` value on `NodeErrorCategory` and a corresponding `PolicyDeniedError` class. The executor's tool-dispatch catch is special-cased so a thrown `PolicyDeniedError` lands in `node_executions.errorCategory` as `policy_denied` instead of the generic `setup`. Policy denials are intentionally NOT in the default retryable-categories list — denying is a stable signal.

  `extractPrimaryResource(node, toolId)` extracts the URL/path/command the tool would touch, ready for PR C's matcher to glob against. Templated values are returned as-is (the seam runs before substitution, by design — authors can write deny rules against literal template strings).

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

## 0.17.0

### Minor Changes

- 998e881: Security: SSRF protection on http-get/http-post, auth token moved from URL query param to fragment, CSP + security headers on dashboard, Postgres bound to localhost in Docker Compose.

## 0.16.1

### Patch Changes

- **docs: update READMEs for v0.16 features.**

  All package READMEs updated to reflect Pulse, build-from-goal, tabbed agent detail, filtering/pagination, LLM defaults, and security improvements.

## 0.16.0

### Minor Changes

- **feat: goal-driven agent builder + self-correcting analyzer.**

  Build-from-goal wizard: describe what you want in plain language, the builder designs a complete DAG. Self-correcting: validates YAML and fixes errors automatically. Agent analyzer reviews existing agents and suggests improvements with "Apply now" one-click save. Dynamic tool catalog injected into builder prompt. Focus prompt and last-run output context for analyzer. Auto-fix shell template mistakes.

- 544fb33: **feat: Pulse signal type + 7 curated example agents (docs sweep PR 1).**

  Adds the `AgentSignal` type (title, icon, format, field, refresh, size) to the Agent interface and Zod schema. Each agent can optionally declare a `signal:` block that defines how its output renders on the `/pulse` dashboard (the agent info radiator — page itself ships later in the dashboard revamp).

  Ships 7 curated v2 example agents that tell a tutorial narrative ("Build a daily briefing system"), replacing the 3 minimal v1 examples:

  1. **hello** — first agent, proves install works
  2. **two-step-digest** — 2-node DAG, teaches dependsOn + upstream passing
  3. **daily-greeting** — cron scheduling
  4. **parameterised-greet** — inputs with defaults (shell + claude-code companion)
  5. **conditional-router** — flow control: conditional + onlyIf + branch merge
  6. **research-digest** — agent-invoke + loop (nested flows)
  7. **daily-joke** — real HTTP via http-get tool (icanhazdadjoke.com, the only example with network)

  Each example has a `signal:` block, a header comment explaining what it teaches, and a run command. All offline examples use mock data from `agents/examples/data/`.

- **feat: DAG executor refactor — LlmSpawner, progress tracking, provider field.**

  Split the monolithic executor into focused modules. LlmSpawner interface abstracts claude/codex CLI providers. progressJson column on node_executions enables real-time turn tracking in the dashboard. Provider field on nodes allows per-node claude/codex selection.

- 2ca929d: **feat: flow control foundation — node types, onlyIf conditional edges, nested run support (Flow PR A).**

  Lays the type + schema + executor foundation for control-flow primitives in agent flows. No new node type dispatch yet (conditional, switch, loop, etc. come in PRs B–E); this PR establishes the data layer and ships the `onlyIf` conditional edge feature end-to-end.

  ### What ships

  - **Extended `NodeType` union**: `conditional`, `switch`, `loop`, `agent-invoke`, `branch`, `end`, `break` join `shell` + `claude-code`. Control-flow types are first-class — the executor will dispatch to dedicated logic per type.
  - **`onlyIf` on `AgentNode`**: edge-level conditional execution. Evaluates a predicate (`equals`, `notEquals`, `exists`) against an upstream node's structured output field before spawning. Skipped nodes get `condition_not_met` (not `upstream_failed`), which cascades to downstream nodes without triggering fail-fast.
  - **Control-flow config interfaces**: `ConditionalConfig`, `SwitchConfig`, `LoopConfig`, `AgentInvokeConfig`, `endMessage` on AgentNode. Ready for PRs B–E to implement.
  - **`condition_not_met` + `flow_ended`** error categories.
  - **`parent_run_id` + `parent_node_id`** on runs table (idempotent migration). Ready for nested agent-invoke runs in PR C.
  - **Zod schema** updated: accepts all new node types + `onlyIf` field. Control-flow nodes skip the command/prompt requirement.
  - **If/else branching** works today: two downstream nodes with complementary `onlyIf` predicates — one runs, the other skips.

  ### Tests

  527 total (521 → 527; +6 new):

  - onlyIf.equals skips when no match / runs when match
  - Cascading condition_not_met to downstream nodes
  - onlyIf.notEquals
  - onlyIf.exists (null = absent)
  - If/else branching pattern (complementary predicates)
  - All 521 existing tests pass unchanged (full backcompat)

- b94f89b: **feat: conditional + switch node dispatch in executor (Flow PR B).**

  First-class `conditional` and `switch` nodes now execute in the DAG. Both run in-process (no child process, no env resolution) and produce structured outputs that downstream nodes consume via `onlyIf` predicates.

  - **`conditional`**: evaluates a predicate (`equals`, `notEquals`, `exists`) against the first upstream's output field. Outputs `{ matched: boolean, value: unknown }`. Downstream nodes gate on `onlyIf: { upstream: check, field: matched, equals: true }`.
  - **`switch`**: matches an upstream field against named cases. Outputs `{ case: string, value: unknown }`. Unmatched values default to `"default"`. Downstream nodes gate on `onlyIf: { upstream: route, field: case, equals: "pro" }`.
  - Both compose with the `onlyIf` conditional edges from PR A for full if/else and multi-branch routing patterns.

- 4b97cc8: **feat: agent-invoke node type + nested runs (Flow PR C).**

  An `agent-invoke` node runs another agent as a nested sub-flow. The sub-agent gets its own `runs` row linked to the parent via `parent_run_id` + `parent_node_id`. The parent node waits for the sub-run to complete and captures its result as structured output.

  - **Recursive `executeAgentDag`** — the executor calls itself with the sub-agent's definition, threading `parentRunId`/`parentNodeId` so the audit trail is complete.
  - **`AgentStore` on `DagExecutorDeps`** — required for resolving sub-agents by id. Fails cleanly when absent or when the sub-agent isn't found.
  - **Input mapping** — `agentInvokeConfig.inputMapping` maps upstream outputs to sub-agent inputs. Supports `upstream.<id>.<field>` path expressions.
  - **Parent node result** = sub-run's final result. Sub-run failure propagates as parent node failure with `setup` category.

- 8b95d36: **feat: loop node type — iterate + invoke sub-agent per item (Flow PR D).**

  A `loop` node iterates over an array from upstream structured output, invoking a sub-agent per item. Each iteration is a nested run linked to the parent. Results are collected into `{ items: result[], count: number }`.

  - **Best-effort**: failed iterations record `null` in the items array; the loop itself only fails on invalid config or missing sub-agent.
  - **`maxIterations`**: caps the iteration count to prevent runaway loops.
  - **`ITEM` + `ITEM_INDEX` inputs**: each sub-agent invocation receives the current item as `$ITEM` and its zero-based index as `$ITEM_INDEX`.

- 48c57f8: **feat: end + break node types — early flow termination (Flow PR E).**

  - **`end` node**: terminates the entire flow cleanly when reached. Status = `completed` (not failed). All remaining nodes are skipped with `flow_ended` category. The node's `endMessage` surfaces in the run detail.
  - **`break` node**: exits the current flow (loop body / sub-flow) only. Within a top-level flow it behaves like `end`; within a loop iteration it stops that iteration and the loop continues to the next item.
  - Both compose with `onlyIf` — an end/break node gated by a conditional only fires when the condition is met. When skipped by `condition_not_met`, the flow continues normally.

- 1744a9f: **feat: branch (merge) node + dashboard viz shapes (Flow PR F — closes flow control).**

  Final flow-control PR. Adds the `branch` merge-point node and distinct Cytoscape shapes for all control-flow node types.

  - **`branch` node**: explicit fan-in merge point. Collects all upstream outputs into `{ merged: Record<string, unknown>, count: number }`. Condition-skipped upstreams are excluded gracefully (the branch always runs, even if some paths were skipped). Bypasses the condition_not_met cascade that would otherwise skip downstream nodes with a skipped dependency.
  - **Dashboard viz shapes**: conditional/switch = diamond, loop = round-octagon, agent-invoke = barrel, branch = round-pentagon, end/break = octagon. Each control-flow type also has a distinct color tint so the DAG at a glance shows where routing happens vs where execution happens.

  ### Flow control is complete

  With PRs A–F, agent flows now support:

  - `conditional` — if/else predicate evaluation
  - `switch` — multi-case routing
  - `loop` — iterate over arrays with sub-agent invocation
  - `agent-invoke` — nested sub-flows with parent-child run linking
  - `branch` — explicit fan-in merge
  - `end` — clean early termination
  - `break` — exit current loop iteration
  - `onlyIf` — edge-level conditional execution on any node

- **feat: Pulse information radiator dashboard.**

  New /pulse page: customizable information radiator with signal tiles showing agent output as live widgets. 9 display templates (metric, text-headline, table, status, time-series, image, text-image, media, + backward compat). Container layout system with drag-and-drop reorder. Edit mode toggle. Widget palette (6 color options). Auto-theming by template type. Conditional thresholds. System metric tiles replace hardcoded health strip. Markdown rendering in text tiles. YouTube click-to-play media player. Tile collapse/expand. All agents wired with signal blocks.

- 3fe5c47: **feat: tool abstraction foundation — types, schema, store, 9 built-in tools (PR 1 of 6 for v0.16).**

  Introduces the **tool** as a named, reusable unit of work a node invokes by reference. Nodes gain `tool` + `toolInputs` fields; the executor will resolve tool refs and dispatch via the built-in registry or user-defined tools (wired in PR 2). This PR lays the data layer only — no runtime dispatch yet.

  ### What ships

  - **`tool-types.ts`** — `ToolDefinition`, `ToolOutput`, `BuiltinToolEntry`, `BuiltinToolContext`, `ToolSource`, `ToolFieldType`, `ToolInputField`, `ToolOutputField`, `ToolImplementation`.
  - **`tool-schema.ts`** — Zod validation for tool YAML (id, name, source, inputs/outputs with typed fields, implementation with type-specific requirements).
  - **`tool-store.ts`** — SQLite `tools` table with CRUD (create, get, list, update, upsert, delete). Mirrors agent-store's `DatabaseSync` + `ensureSchema()` pattern.
  - **`builtin-tools.ts`** — registry of 9 built-in tools: `shell-exec`, `claude-code`, `http-get`, `http-post`, `file-read`, `file-write`, `json-parse`, `json-path`, `template`. Each has a `ToolDefinition` (schema) + a Node-native `execute()` function.
  - **`AgentNode.tool`** + **`AgentNode.toolInputs`** — optional fields on the v2 node type. When `tool` is set, the node schema doesn't require inline `command`/`prompt` (the tool provides them). `type` stays required for backwards compat — the YAML parser derives it from the tool's implementation at load time.
  - **`NodeExecutionRecord.outputsJson`** — new column on `node_executions` for structured tool outputs. Idempotent `ALTER TABLE ADD COLUMN` migration on first open.
  - **`NodeStructuredOutput`** type + `NodeOutput.outputs` field for in-memory structured output passing between nodes.
  - **Variable defaults confirmed** — `AgentInputSpec.default` + `description` already exist in types, Zod schema, and executor resolve. The UI surface (agent detail sidebar) is the remaining task.

  ### Tests

  508 total (484 → 508; +24 new):

  - `tool-schema.test.ts` — 7 tests: valid shell/claude-code/builtin tools, invalid id, missing required fields, typed inputs/outputs round-trip.
  - `tool-store.test.ts` — 7 tests: create, get, list (sorted), update, upsert, delete, nonexistent lookups.
  - `builtin-tools.test.ts` — 10 tests: registry lists all 9 tools, retrieval by id, isBuiltinTool checks, shell-exec executes a command, json-parse/json-path/template/file-read exercise the execute functions.

- 2cb27af: **feat: executor tool dispatch + output framing (PR 2 of 6 for v0.16).**

  Wires the tool abstraction from PR 1 into the DAG executor so nodes with `tool:` actually run. Adds an output framing protocol for extracting structured JSON from shell tool stdout.

  ### What ships

  - **Executor tool dispatch** — when a node has `tool:` set, the executor resolves it from the built-in registry (or the `ToolStore` for user-defined tools) and calls the tool's `execute()` function directly. Built-in tools run in-process; user tools with shell/claude-code implementations go through the existing `spawnProcess` path with a synthetic node shape derived from the tool's definition.
  - **Output framing** (`output-framing.ts`) — extracts the last JSON-parseable line from stdout as structured output. Shell tools that `printf '{"status":200}'` on their last line get automatic structured output capture. Plain-text stdout (v0.15 style) falls back to `{ result: stdout }`.
  - **`outputsJson` stored** — every completed node now writes its structured output to `node_executions.outputsJson` (the column PR 1 added). Both tool-dispatched and legacy-spawned nodes populate it.
  - **`ToolStore` on `DagExecutorDeps`** — optional; when present, the executor resolves user-defined tools from it. When absent, only built-in tools are available.
  - **v0.15 nodes unchanged** — nodes without `tool:` go through the existing spawn path. No backcompat desugaring at exec time; opt-in only.

  ### Design notes

  - Built-in tool `exit_code` is extracted from the `ToolOutput` object (tools return it as a field). Legacy spawns use the process exit code as before.
  - The executor tries framed-output extraction even on legacy nodes — if a v0.15 shell script happens to emit a JSON last line, it'll be captured. No harm if it doesn't.
  - Template resolver v2 (path-based `{{upstream.X.body.items[0]}}`) is deferred to PR 3 — this PR gets tools running; the next PR makes their outputs addressable.

  ### Tests

  517 total (508 → 517; +9 new):

  - `output-framing.test.ts` — 9 tests: JSON object/array extraction, trailing empty lines, non-JSON fallback, empty stdout, single-line JSON, `buildToolOutput` framed vs plain.
  - All 508 existing tests pass unchanged.

- 21cc114: **feat: tool picker on node forms + tool config/actions types (PR 4 of 6 for v0.16).**

  Replaces the Shell/Claude Code type radio on add-node and edit-node forms with a tool dropdown listing all 9 built-in tools + user tools. Selecting a tool dynamically renders its declared input fields with palette autocomplete (both `$` and `{{` triggers). Extends the tool model with `config` (project-level defaults) and `actions` (multi-action tools).

- 6c25718: **feat: global variables store + `sua vars` CLI (Variables PR 1 of 6).**

  Adds a plain-text global variables store at `.sua/variables.json` for non-sensitive project-wide values (API_BASE_URL, REGION, DEFAULT_TIMEOUT). Variables are visible to every agent at run time — executor wiring comes in PR 2.

  - **`VariablesStore`** in core — JSON-backed CRUD with `get/set/delete/list/getAll`. Creates the `.sua/` directory on first write.
  - **`sua vars list/get/set/delete`** CLI — mirrors the secrets CLI pattern. `set` warns when a name looks sensitive (TOKEN, KEY, PASS, SECRET) and suggests using `sua secrets set` instead.
  - **`looksLikeSensitive()`** helper — flags names that probably belong in the encrypted store.

- ffa2986: **feat: executor variables wiring + {{vars.NAME}} template resolver (Variables PR 2 of 6).**

  Global variables from `.sua/variables.json` are now injected into every node at run time.

  - **Shell nodes**: `$NAME` env var, injected after secrets but before inputs (inputs win on collision).
  - **Claude-code prompts**: `{{vars.NAME}}` template substitution via `resolveVarsTemplate()`.
  - **Precedence**: `--input` override > agent input default > global variable > secret.
  - **`VariablesStore` on `DagExecutorDeps`**: optional; when absent, no variables injected.

## 0.15.0

## 0.14.0

### Minor Changes

- f7c0689: **feat: DAG executor (PR 3 of 5 for agents-as-DAGs).**

  Walks an Agent's nodes in topological order, writes one `node_executions` row per node, categorises every failure, and skips downstream nodes cleanly when an upstream fails.

  Not yet wired into `LocalProvider.submitRun` — that swap lands in PR 4 alongside the v1 YAML migration + `sua workflow` CLI verbs. In this PR the executor is callable via `executeAgentDag(agent, options, deps)` but nothing ships a v2 Agent to it yet.

  ### What ships

  - **`executeAgentDag(agent, opts, deps)`** — creates the parent `runs` row, walks nodes topologically, writes per-node records, rolls up final status. Returns the completed `Run`.
  - **`topologicalSort(nodes)`** — Kahn's algorithm with declared-order tiebreaker. Deterministic output; defensive cycle-throw even though the v2 schema already rejects cycles.
  - **`resolveUpstreamTemplate(text, snapshot)`** — substitutes `{{upstream.<nodeId>.result}}` refs and escapes `{{` inside the substituted value so the inputs resolver can't re-expand a second time (same defense as v1 chain-resolver).
  - **`SpawnNodeFn`** injection point — production uses the built-in real spawner; tests provide canned responses without touching `spawn()`.

  ### Error categorization (per the plan's table, every row tested)

  | Failure                                         | `errorCategory`   | Source                         |
  | ----------------------------------------------- | ----------------- | ------------------------------ |
  | Secrets store missing / locked / missing secret | `setup`           | pre-spawn `buildNodeEnv` throw |
  | Missing required input at runtime               | `setup`           | pre-spawn resolve              |
  | Community shell agent not allow-listed          | `setup`           | pre-spawn gate                 |
  | `spawn()` failed (ENOENT, EACCES)               | `spawn_failure`   | exit 127 or error event        |
  | Ran but exited non-zero                         | `exit_nonzero`    | exit != 0                      |
  | Exceeded node timeout                           | `timeout`         | exit 124 after SIGTERM         |
  | Upstream failed → this node never ran           | `upstream_failed` | fail-fast short-circuit        |

  Categories with any non-completed status (failed / cancelled / skipped) are always populated; completed rows have `errorCategory: undefined`.

  ### Trust-source propagation (simplified from v1)

  The v1 chain-executor wrapped community upstream output in `--- BEGIN UNTRUSTED INPUT ---` delimiters because cross-agent chains could mix trust levels. In v2 every node inside one agent shares the parent's `source` — no cross-agent output reaches a trusted node within a single DAG. What stays: the community-shell gate. A shell node inside a `source: community` agent refuses unless the whole agent is in `allowUntrustedShell`. Same error (`UntrustedCommunityShellError`), same allow-list semantics; granularity stays at the agent id.

  ### Env + secrets (per-node)

  Each node spawns with its own env built from scratch:

  1. `process.env` filtered by trust level (MINIMAL for community, LOCAL for local/examples)
  2. Node's `envAllowlist` additions
  3. Node's YAML `env:` values (with `{{inputs.X}}` + `{{upstream.X.result}}` templates resolved)
  4. Node's **own** declared secrets from `secretsStore` — not shared across nodes
  5. Agent-level inputs (caller-supplied + defaults; sensitive names blocked even if they slip past schema)
  6. `UPSTREAM_<NODEID>_RESULT` env vars for each declared upstream

  Logged inputs (`inputs_json` on `node_executions`) redact values for any key the node declared as a secret, so reading run logs doesn't leak credentials.

  ### Tests

  27 new cases in `dag-executor.test.ts`. 367 → 394 repo-wide.

  - Topological sort (ordering, diamond, cycle throw)
  - Upstream template substitution (incl. the `{{` re-expansion defense)
  - Single-node execution: success, exit_nonzero, timeout (124), spawn_failure (127)
  - Multi-node DAG: topological execution order, upstream snapshot persistence, `UPSTREAM_*_RESULT` env injection, fail-fast + skipped downstream with `upstream_failed`
  - Secrets: injection, log redaction, missing-secret → setup, no-store → setup
  - Inputs: caller values, agent defaults, missing-required → setup
  - Community shell gate: refused by default, allowed when allow-listed, claude-code bypass
  - Env allowlist by trust level: community MINIMAL, local LOCAL

  ### What's NOT in this PR

  - Replay-from-node (PR 4 — introduces new runs with copied upstream snapshots)
  - LocalProvider wiring (PR 4 — v1 agents still dispatch through `chain-executor.ts`)
  - Removal of `chain-executor.ts` (PR 4 — once nothing calls it)
  - Dashboard DAG viz (PR 5)

- 31fd09f: **feat: v1 → v2 migration + `sua workflow` CLI + replay-from-node (PR 4 of 5 for agents-as-DAGs).**

  This PR wires everything from PRs 1–3 together into user-facing functionality. Users can now import their v1 YAML chains, see the merged DAGs, run them, inspect per-node logs, and replay from a specific node — all via the new `sua workflow` command tree.

  ### Migration (`agent-migration.ts` in core)

  - `planMigration(inputs)` — pure function, no filesystem reads; takes the v1 agent set, builds transitive `dependsOn` closures, emits one DAG-agent per connected component. Idempotent.
  - `applyMigration(plan, store)` — upserts into `AgentStore` with `createdBy: 'import'`. Leaf of the component becomes the DAG's id. `{{outputs.X.result}}` rewritten to `{{upstream.X.result}}`. `.yaml.disabled` files (v0.11's paused state) map to `status: 'paused'`.
  - Defensive rejections: mixed-source components (e.g. local depending on community) refused with a clear warning; fan-out components with multiple leaves emit an advisory and pick the alpha-first leaf; missing `dependsOn` targets flagged.
  - 14 new tests covering isolated agents, linear chains, diamonds, fan-outs, mixed-source refusal, template rewrite, idempotent re-runs, version bumps on DAG changes, commit-message preservation.

  ### `sua workflow` CLI command tree

  | Verb                                                          | What it does                                              |
  | ------------------------------------------------------------- | --------------------------------------------------------- |
  | `import [dir] [--apply]`                                      | Dry-run by default; `--apply` commits migration to the DB |
  | `list [--status <s>] [--source <s>]`                          | Table of imported DAG agents                              |
  | `show <id> [--format yaml]`                                   | Text DAG view or full YAML export                         |
  | `run <id> [--input KEY=value] [--allow-untrusted-shell <id>]` | Execute synchronously via DAG executor                    |
  | `status <id> <status>`                                        | active / paused / archived / draft                        |
  | `logs <runId> [--node <id>] [--category <cat>]`               | Per-node execution table with category filter             |
  | `replay <runId> --from <nodeId>`                              | Re-run from the pivot, reusing stored upstream outputs    |
  | `export <id>`                                                 | Emit YAML to stdout (round-trips with `import-yaml`)      |
  | `import-yaml <file>`                                          | Ingest a v2 YAML file directly (bypasses v1 migration)    |

  Run id prefixes work for `logs`/`replay`. Every command shares a single `DatabaseSync` connection via `AgentStore.fromHandle` + `RunStore.fromHandle`.

  ### Replay-from-node (new executor mode)

  `executeAgentDag(agent, { replayFrom: { priorRunId, fromNodeId } })`:

  - Copies prior `node_executions` rows for every node before the pivot in topological order, preserving their `result`, `started_at`, and `completed_at`. The audit trail makes clear these are historical, not fresh.
  - Seeds the executor's outputs map with copied results, so the pivot node sees exactly the upstream snapshot the original run produced.
  - Re-executes the pivot and all downstream nodes fresh.
  - `runs.replayed_from_run_id` + `replayed_from_node_id` populated for the UI breadcrumb.
  - Refuses the replay if the pivot isn't in the agent or if any pre-pivot node in the prior run lacks a completed result — fail-fast setup-category error rather than running the pivot with empty upstream.

  4 new replay tests: copy behavior, upstream snapshot preservation at pivot, pivot-not-in-agent refusal, missing-prior-outputs refusal.

  ### Tests

  18 new (14 migration + 4 replay). 394 → 412 repo-wide.

  ### What's NOT in this PR (landing in PR 4b before PR 5)

  - `LocalProvider.submitDagRun` — today `sua workflow run` calls the DAG executor directly. MCP and scheduler still dispatch to v1 agents via `LocalProvider.submitRun`. PR 4b adds dispatch so all three triggers (CLI, MCP, cron) route through the same DAG executor.
  - Removal of `chain-executor.ts` — stays alive until the LocalProvider swap is complete.
  - `@deprecated` markers on v1 `AgentDefinition` — paired with the swap.

  Dashboard DAG visualisation is PR 5.

  ### Manual verification

  ```bash
  cd /tmp && mkdir play && cd play
  sua init
  cat > agents/local/fetch.yaml <<EOF
  name: fetch
  type: shell
  command: "echo headlines"
  source: local
  EOF
  cat > agents/local/summarize.yaml <<EOF
  name: summarize
  type: shell
  command: "echo got=\$UPSTREAM_FETCH_RESULT"
  source: local
  dependsOn: [fetch]
  EOF
  sua workflow import --apply         # merges into one DAG named 'summarize'
  sua workflow list                   # shows fetch + summarize as a 2-node DAG
  sua workflow show summarize         # DAG topology as text
  sua workflow run summarize          # runs fetch → summarize; output: got=headlines
  sua workflow logs <runId>           # per-node table with categorised errors
  sua workflow replay <runId> --from summarize   # re-runs summarize with fetch's stored output
  sua workflow export summarize       # emits YAML
  sua workflow status summarize paused
  ```

### Patch Changes

- b7c73aa: **feat: dashboard DAG visualization + per-node execution table (PR 5 of 5 for agents-as-DAGs).**

  Completes the v0.13 user story: import your v1 YAML into DAG agents, run them, watch them in the dashboard with a real graph view and per-node logs.

  ### What ships

  - **`/agents` page** splits into two tables: v2 "DAG agents" (from AgentStore) at the top, unmigrated v1 YAML agents below. An id that exists in both tables collapses to the v2 row; the v1 header only appears when there are v1-only agents to show.
  - **`/agents/:id`** (v2 variant) renders the DAG visually via Cytoscape.js (client-rendered from a server-supplied `<script type="application/json">` payload). Nodes are round-rectangles colored by type (shell green / claude-code magenta) with edges pointing downstream. `<noscript>` fallback lists nodes textually. "Run now" dispatches to the DAG executor; community-shell DAGs require confirmation.
  - **`/runs/:id`** gains a per-node execution table for DAG runs: status, error category, duration, exit code. The DAG viz renders here too, with nodes color-coded by their execution status (completed / failed / running / skipped / cancelled). Each row links to a per-node detail section with stderr and stdout. "Replayed from …" breadcrumb shown when present.
  - **Static assets** served from `/assets/cytoscape.min.js` + `/assets/graph-render.js` with long-cache headers. Cytoscape is resolved from `node_modules` at startup; no CDN, no bundler.

  ### Files

  - New: `packages/dashboard/src/routes/assets.ts`, `views/dag-view.ts`, `views/agent-detail-v2.ts`
  - Modified: `context.ts` (adds AgentStore), `index.ts` (opens AgentStore via shared path), `routes/agents.ts` (v2-first lookup), `routes/run-now.ts` (dispatches to DAG executor for v2), `routes/runs.ts` (joins node_executions for v2 runs), `views/agents-list.ts` (two-table split), `views/run-detail.ts` (DAG + per-node table when v2)

  ### Design constraints preserved

  - No CDN
  - No bundler (cytoscape vendored through npm, served from node_modules)
  - No framework (client JS = 2KB vanilla bootstrap)
  - v2 tagged-template rendering for everything HTML

  ### Tests

  8 new cases in `dashboard.test.ts`:

  - v2 agents appear under a "DAG agents" header on `/agents`
  - `/agents/:id` renders the Cytoscape JSON payload with correct nodes + edges
  - v2 preferred over v1 when same id in both
  - `/runs/:id` shows per-node table + DAG for v2 runs
  - `/runs/:id` stays minimal for v1 runs (no per-node UI)
  - Replayed-from breadcrumb renders when present
  - `/assets/cytoscape.min.js` serves (~100KB+)
  - `/assets/graph-render.js` serves with correct content-type

  412 → 420 repo-wide.

  ### Manual verification

  ```bash
  sua workflow import --apply
  sua workflow run <agent-id>
  sua dashboard start --port 3000
  # /agents → DAG agents table
  # /agents/<id> → DAG rendered + node list
  # /runs/<id> → per-node table + DAG colored by node status
  ```

  ### Deferred to v0.14

  - Drag-and-drop DAG editing (plan's v0.14 scope)
  - Node inspector (edit secrets/inputs/env in UI)
  - Version history view + diff + rollback in UI
  - `/settings/*` tree (secrets / integrations / general)
  - Version-aware DAG rendering (currently shows current_version's DAG for all runs; a follow-up can pull the exact version the run executed)
  - `LocalProvider.submitDagRun` unification (MCP + scheduler still dispatch to v1 chain-executor — dashboard now dispatches DAG directly)

## 0.13.0

### Minor Changes

- e8b3079: **feat: AgentStore + RunStore extensions (PR 2 of 5 for agents-as-DAGs).**

  DB schema + CRUD for the v0.13 agents-as-DAGs architecture. No runtime consumers yet — the executor (PR 3) and migration/CLI (PR 4) are the consumers.

  ### `AgentStore`

  CRUD over two new tables in the same SQLite file as `runs.db`:

  - `agents` — mutable per-agent metadata (name, description, status, schedule, source, mcp exposure, `current_version` pointer, `provenance_json` for v0.15+ catalog tracking, timestamps).
  - `agent_versions` — immutable DAG snapshots (nodes + agent-level inputs + author/tags). FK to `agents` with ON DELETE CASCADE.

  ```ts
  const agent = store.createAgent({ id, name, status, source, mcp, nodes, ... }, 'cli');
  // Every edit that changes the DAG = new version
  const v2 = store.createNewVersion(id, updatedDag, 'dashboard', 'added retry');
  // Metadata edits don't bump version
  store.updateAgentMeta(id, { status: 'archived' });
  // Rollback
  store.setCurrentVersion(id, 1);
  // List + filter
  store.listAgents({ status: 'active', source: 'community' });
  ```

  `upsertAgent` handles the idempotent import case: creates on first call, updates metadata if only metadata changed, creates a new version only when the DAG shape actually differs. Used by the v1 → v2 migration (PR 4) to stay idempotent across re-runs.

  ### `RunStore` extensions

  - `runs` table gets four new nullable columns via idempotent migration: `workflow_id`, `workflow_version`, `replayed_from_run_id`, `replayed_from_node_id`. Pre-v0.13 rows stay valid; migration uses `PRAGMA table_info` to skip if already applied.
  - New `node_executions` table keyed on `(runId, nodeId)` with FK cascade to `runs`. Persists per-node status, error, error category, results, resolved inputs, and the upstream output snapshot that fed the node (critical for replay-from-node).
  - New CRUD: `createNodeExecution`, `updateNodeExecution` (partial patch), `getNodeExecution`, `listNodeExecutions(runId)` (startedAt ASC — topological order), `queryNodeExecutionsByCategory(category)` (drives `sua workflow logs --category=timeout` in PR 4).
  - Partial index on `errorCategory` (where non-null) keeps category queries cheap.
  - `Run` type gains optional `workflowId`, `workflowVersion`, `replayedFromRunId`, `replayedFromNodeId` fields.

  ### Shared-handle pattern

  Both stores expose a static `fromHandle(db: DatabaseSync)` factory. Used by the CLI main process and the DAG executor so both stores share one connection to `runs.db` (avoids two handles on the same file). Stores created via `fromHandle` do not close the DB on `.close()` — ownership stays with whoever opened the handle. Path-based constructors are unchanged; existing callers (`LocalProvider`, dashboard, CLI status/logs/cancel) need zero changes.

  ### Tests

  29 new cases: 22 AgentStore + 7 RunStore extensions including the legacy-DB migration test. 338 → 367 repo-wide.

  ### What's deliberately NOT here

  - DAG executor (PR 3) — consumes `AgentStore.getAgent()` + `RunStore.createNodeExecution()`
  - v1 YAML migration (PR 4) — uses `AgentStore.upsertAgent()` with `createdBy: 'import'`
  - Dashboard DAG viz (PR 5)

- 0e21b19: **feat: Agent v2 types + YAML schema + round-trip (PR 1 of 5 for agents-as-DAGs).**

  Foundation work for the v0.13.0 "agent is a DAG of nodes" architecture. No runtime behavior change yet; nothing else in the repo consumes these types. Each subsequent PR in the series adds a layer:

  - **This PR (v2 types + YAML):** `Agent`, `AgentNode`, `AgentVersion`, `NodeExecutionRecord` types; Zod schema for YAML v2; `parseAgent()` + `exportAgent()` round-trip
  - **PR 2 (agent-store + run-store):** DB schema for `agents`, `agent_versions`, `node_executions`; CRUD
  - **PR 3 (DAG executor):** topological walk, per-node record writes, trust-source propagation (lifted from `chain-executor`), `{{upstream.<nodeId>.result}}` template substitution
  - **PR 4 (migration + CLI):** auto-merge v1 YAML chains into DAG-agents; `sua workflow` verbs
  - **PR 5 (dashboard viz):** Cytoscape-rendered DAG on `/agents/:id`, per-node execution table on `/runs/:id`

  ### What's in this PR

  - `Agent` / `AgentNode` / `AgentStatus` / `NodeOutput` / `NodeExecutionRecord` / `AgentVersion` types
  - Zod schema with:
    - Unique node ids, valid `dependsOn` references, cycle detection
    - Template validation: `{{inputs.X}}` must be declared; `{{upstream.Y.result}}` must be a declared upstream node
    - Shell-command template rejection (same env-var convention as v1)
    - Sensitive-env input name shadowing rejection (reuses v1's `SENSITIVE_ENV_NAMES`)
    - Cron cap (reuses v1's `validateScheduleInterval`)
  - `parseAgent(yaml): Agent` with a typed `AgentYamlParseError` carrying validation issues
  - `exportAgent(agent): string` with stable key order for git-diff-friendly output
  - `exportAgents(agents): Map<filename, yaml>` for dumping a whole workspace

  36 new tests (24 schema + 12 YAML round-trip). 302 → 338 repo-wide.

  ### Why YAML stays a first-class concern

  Per the v0.13 plan: DB is editable runtime state; YAML is the lossless serialization format for git, portability, and review. `parse(export(a)) ≈ a` for every valid `Agent` is a test invariant. Stable key order + omit-undefined-fields keeps diffs predictable.

  ### Template vocabulary recap

  - `{{inputs.X}}` — agent-level caller-supplied input (caller passes `--input X=value`)
  - `{{upstream.<nodeId>.result}}` — upstream node's stdout within this agent (claude-code only; shell nodes read `$UPSTREAM_<NODEID>_RESULT` env vars)
  - `{{outputs.X.result}}` (v1 cross-agent) — removed. Migration in PR 4 rewrites these as `{{upstream.X.result}}` within merged agents.

## 0.12.0

### Minor Changes

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

## 0.11.0

### Minor Changes

- a21055c: **feat: agent lifecycle verbs — `edit`, `disable`, `enable`, `list --disabled`.** A set of small commands for the day-to-day "I want to tweak this agent without memorizing paths, or pause it without losing the YAML" flows.

  ### `sua agent edit <name>` — open the YAML in $EDITOR Resolves the agent name to its source file, spawns `$EDITOR`(or`$VISUAL`, falling back to `vi`on Unix /`notepad`on Windows), then re-parses and validates on save. Validation errors name the offending field and the file path so you can jump back and fix without waiting for`sua agent run` to surface the problem.

  ```bash
  sua agent edit hello                       # open in $EDITOR
  sua agent edit hello --print-path          # just print the resolved path
  code "$(sua agent edit hello --print-path)"   # hand the path to VS Code
  ```

  Under the hood, `AgentDefinition.filePath` is now populated by the loader (runtime-only metadata, not part of the on-disk schema) so `audit`, `doctor`, and any future `agent edit`-adjacent verbs have a single source of truth for "where did this agent come from." Non-TTY invocations print the path to stdout instead of spawning an editor — lets you compose with other tools without interactive state.

  When the named agent isn't found but there's a matching file on disk that the loader skipped (invalid YAML, failed schema check), the error now names those files and their loader warnings so broken edits don't silently disappear from `sua agent list`.

  ### `sua agent disable <name>` / `sua agent enable <name>` — pause without deleting

  ```bash
  sua agent disable claude-test    # renames to claude-test.yaml.disabled → loader skips it
  sua agent list --disabled        # see what's paused
  sua agent enable claude-test     # rename back
  ```

  The loader already ignores anything that isn't `.yaml` / `.yml`, so the `.disabled` suffix is the only state change — no schema fields, no hidden files. Examples (bundled) agents refuse to disable; community agents refuse by default with `--force` to override. Disabling a scheduled agent prints a reminder to restart any running `sua schedule start` daemon so it drops the in-memory cron job.

  `enable` matches on the YAML's declared `name:` field rather than the filename, so renaming the file independently of the agent name still works. Conflicts (disabling when `.disabled` already exists, enabling when a new `.yaml` has claimed the slot) refuse with a clear "resolve manually" message rather than clobbering either file.

### Patch Changes

- ad651db: **fix: don't open the secrets store for agents that declare no secrets.**

  v0.10.0 regression: `LocalProvider.submitRun` and `runAgentActivity` both called `secretsStore.getAll()` unconditionally for every run, which meant any agent — even one with no `secrets:` field — needed the store to be unlockable. On a v2 passphrase-protected store that turned every run into "set SUA_SECRETS_PASSPHRASE or nothing works", which was never the intent.

  Now the store is only opened when the agent actually declares secrets. Regression test in `local-provider.test.ts` uses a store that throws on any read and asserts the provider never touches it for an agent with no `secrets:` field.

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

## 0.3.2

## 0.3.1

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

## 0.2.0

### Minor Changes

- 3122f3f: Initial public release. Local-first agent playground with YAML agent definitions, CLI (`sua`), MCP server (HTTP/SSE), Temporal provider for durable execution, encrypted secrets store, and env filtering to prevent secret leakage to community agents.
