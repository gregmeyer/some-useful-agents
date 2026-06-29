# Build from a goal

Describe what you want in plain language and sua designs the agents, output
widgets, and dashboard tiles for you. Two entry points share the same machinery:

- **Build from goal** — the Build button on `/` and `/agents`. Starts from an
  empty goal and can produce one agent or a whole dashboard.
- **Improve layout** — the wizard on the home board (`/`) and any `/dashboards/:id`. Starts
  from an *existing* layout and proposes what to surface, add, or create.

## The build flow

`POST /agents/build` hands the goal to a server-side orchestrator
(`packages/dashboard/src/routes/build-orchestrator.ts`) that owns a per-process
session and runs three specialist agents in sequence:

1. **`goal-surveyor`** breaks the goal into fragments — one per agent that needs
   to exist. If the goal is already covered by an installed agent it returns
   nothing, and the session ends in `nothing_to_build` instead of inventing a
   redundant agent.
2. **`agent-drafter`** runs once per fragment, in parallel, each writing one
   agent's YAML. Every draft passes through a structural critic
   (`critiquePlan` in `packages/core/src/build-plan-critic.ts`); on a validation
   failure the drafter is re-fired with the critic's feedback, up to
   `MAX_DRAFT_ATTEMPTS` (3) times.
3. **`dashboard-designer`** assembles the drafted agents into dashboard sections
   and tiles when the goal calls for more than a single agent.

The assembled result is a `BuildPlan` (`packages/core/src/build-plan-schema.ts`).

### Single-agent fast path

The Improve-layout wizard drafts one spec at a time via `POST /agents/draft-one`,
which skips the surveyor/designer and runs a single `agent-drafter` + critic
pass. This is what powers inline "draft the missing agent" without a full
survey.

### Polling and statuses

`GET /agents/build/:runId` advances the state machine and reports the current
phase. Session phases:

| phase | meaning |
| --- | --- |
| `survey` | goal-surveyor running |
| `drafting` | one or more agent-drafters running |
| `design` | dashboard-designer running |
| `assembling` | building the final BuildPlan |
| `done` | plan ready to review |
| `nothing_to_build` | goal already covered — nothing drafted |
| `failed` | unrecoverable error |

Mixed outcomes (some drafts succeeded, some exhausted their retries) surface as a
**partial-success** screen: you can commit the good agents and skip the rest.

### Committing

Reviewed plans are written via `POST /agents/build/commit`. Each new agent is
committed sequentially as its own `agent_versions` row. Unresolved critic
warnings can be overridden with **Commit anyway**.

## The critic

`critiquePlan` runs structural checks against catalog reality before a draft is
ever shown to you, so the LLM's mistakes are caught and fed back rather than
saved. Current checks include:

- **Cross-references** — `{{outputs.X}}` / agent-invoke targets must resolve to a
  node or agent that exists in the plan or catalog.
- **ai-template nested paths** — bans `{{outputs.X.Y}}` / `{{item.X.Y}}`; the
  template grammar only resolves one level, so nested paths render blank.
- **img-src hosts** — external `<img>` hosts must be declared in
  `permissions.imgSrc`; the critic prompts to allow the host.
- **dead image links** — every hardcoded `http(s)` image URL baked into an agent
  (in a shell command or an ai-template) is HEAD-checked
  (`build-plan-image-check.ts`). URLs returning HTTP 404/410 are fed back to the
  drafter for a retry — a host can be allowlisted *and* still 404 because the LLM
  hallucinated the path. Inconclusive results (network error, 403, 429, 5xx) are
  never flagged, and template placeholders (`{{outputs.image_url}}`) and data
  URIs are skipped. This check makes outbound requests, so it's a no-op when the
  planner runs without the `checkImageUrl` dependency (e.g. tests, offline).
- **signal.template = widget** — an agent that declares an `outputWidget` must use
  `signal.template: widget` so its Pulse tile mirrors the widget. A mismatch
  (e.g. `text-image`) produces a broken tile, so the critic flags it.

## Improve layout (Path A / Path B)

The Improve-layout wizard reuses the same drafter, but it starts from a current
layout and emits a `LayoutPlan` (`packages/core/src/layout-plan-schema.ts`) that
sorts agents into containers and adds two extra arrays:

- **Path A — `toAdd[]`** — agents you already have installed but that aren't on
  this surface yet. One click adds them.
- **Path B — `needsNew[]`** — specs for agents that *don't exist yet* (a
  `purpose` and optional `suggestedName`). The wizard drafts them inline via
  `/agents/draft-one` and adds the results.

Curation differs by surface: on Pulse, un-surfaced agents get `pulseVisible:
false`; on a named dashboard, the commit endpoint rewrites
`layout.sections[].agentIds`, so un-surfaced agents are removed from the
dashboard (recover them with **Add tile**).

Routes:

- Pulse — `pulse-layout-plan.ts` (`/pulse/layout-plan…`)
- Dashboards — `dashboard-layout-plan.ts` (`/dashboards/:id/layout-plan…`)

## Telemetry

Every planner session records a row consumed by `GET /metrics/planner`:
first-attempt-clean rate, retry counts, failure classes, and commit rate.

## Build stamp

`npm run build` writes `dist/build-info.json` (git short SHA + ISO build time).
`GET /health` returns `{ commit, builtAt }` and the dashboard footer shows
`sua vX · <sha>`. A `-dirty` suffix means the build tree had uncommitted changes.
Because the daemon serves the dist from when it last started, this is the
ground truth for "is the running daemon actually on the code I just merged?":

```bash
curl -s localhost:3000/health | jq '{commit, builtAt}'   # vs git rev-parse --short HEAD
```

## Related

- [Dashboard tour](dashboard.md) — where the Build and Improve-layout buttons live
- [Output widgets](output-widgets.md) — the widget types the drafter can target
- [Agents reference](agents.md) — the YAML the drafter produces
