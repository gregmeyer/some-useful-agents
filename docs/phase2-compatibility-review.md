# Phase 2 Compatibility Review — Semantic Agent Cluster Routing vs. `some-useful-agents`

**Reviewed against:** `ARCHITECTURE.md` rev 2 (Semantic Agent Cluster Routing, Phase 2).
**Target codebase:** `some-useful-agents` ("sua"), commit on branch `fix/loop-over-unframed-shell-json`.
**Method:** read-only inventory of `packages/*/src`. Every load-bearing claim is cited `path:line`; absences show the search that returned nothing; unconfirmed reasoning is marked `(inference)`.

> Scope caveat the design should know up front: the review prompt assumes the target is a "Phase 1 cluster system" — specialist agents *already embedded and grouped into clusters*. sua is not that. It is a deterministic DAG workflow engine (v2) plus a legacy single-agent path (v1). There are no embeddings, no clusters, and no routing layer anywhere in it. So most of Phase 2 is a **green-field build on top of sua**, not a retrofit of an existing cluster system.

---

## 1. Verdict

Phase 2 does not "fit" sua so much as **sit almost entirely above it**: L1 (decomposer), L2 (retrieval), L2.5 (disclosure), L3 (governor), and the L6 learning loop have **zero existing implementation** — no embeddings, no vector math, no clustering, no capability cards, no routing (`rg` for `cosine|hdbscan|softmax|entropy|"capability card"|governor|arbitrat` over `packages/*/src` → 0 each). What sua contributes is a solid **substrate for L4/L6-telemetry and LX-discipline**: a versioned agent store pinned to runs, a rich per-node trace table, a provider-fallback trail, and — importantly — an execution model that already enforces the §8 "read only your DAG ancestors" rule at the node level.

The single biggest obstacle is a **tie between two load-bearing assumptions the code contradicts**: (1) the design's credit-assignment, §8 artifact passing, and vote/merge arbitration all require **machine-checkable per-agent output contracts**, and sua has none — declared `outputs:` is "documentation, not a contract" (`agent-v2-schema.ts:251-260`) and runtime output is unvalidated last-line-JSON convention (`output-framing.ts:25-46`); and (2) L2 speculative search and L3 parallel dispatch require **real concurrency**, and sua's executor is **strictly sequential** (`dag-executor.ts:437`). Either one alone is a major build; together they mean the "fast, contract-bounded fan-out" premise is unbuilt in both dimensions.

The good news the design should bank on: sua's `node_executions` table already gives you ~80% of an M1 trace schema for free, `agent_versions` gives you the non-stationarity key, and the node-scoped context model means you do **not** have a context-bleed retrofit to do (concern #12). Recommend re-sequencing so M0 (cards + embeddings + clustering) is understood as the true first buildable milestone, and folding three cheap-now schema changes into it.

---

## 2. Layer inventory (L0–L6, LX)

| Layer | Status | Evidence |
|---|---|---|
| **L0 Intake** | Partial (as parameters, not as a modeled request) | Entry points exist but take a *known agent id + inputs*, not a raw request/attachments/session: MCP `run-agent` (`mcp-server/src/tools.ts:194,218`), dashboard `POST /agents/:name/run` (`dashboard/src/routes/run-now.ts:27`), CLI `sua workflow run` (`cli/src/commands/workflow.ts:320`). Inputs pass through verbatim (`dag-executor.ts:180`). No intake stage embeds or classifies a request. |
| **L1 Decomposer** | Absent at runtime; design-time analog only | No runtime request→sub-task-DAG decomposer (`rg -niE "decompos|route.*request" packages/*/src` → only build-time hits). The analog is `build-orchestrator` `goal-surveyor`, which decomposes a *build goal* into agent fragments (`dashboard/src/routes/build-orchestrator.ts:4-8`) — it emits agents to scaffold, not a routing plan. No specificity signature. |
| **L2 Retrieval** | Absent | No vector math / narrow-wide search. Current "retrieval" = an LLM reading a **flat, 30-agent-capped text catalog** (`core/src/discovery-catalog.ts:202-236`). The only similarity code is **Jaccard bag-of-words over past build-plans** (`core/src/planner-loop/memory-retrieval.ts:56`, `MIN_SIMILARITY=0.15` `:22`) — lexical, and over plans, not agents. |
| **L2.5 Disclosure** | Absent | No candidate-set rendering, no team picker, and **no human-in-the-loop / pause node** in the node-type enum (`agent-v2-types.ts:30-38`). A DAG run cannot pause mid-execution and resume. Closest shapes are for *building* (§4). |
| **L3 Governor** | Absent | No per-cluster pipeline, no arbitration modes, no routing cache/fast-path/confidence gate (`rg -ni confidence packages/*/src` → 0; `governor`/`arbitrat` → 0). The provider **waterfall** (`node-spawner.ts:674`) is a per-node *LLM* fallback, not a governor. |
| **L4 Specialists** | Present as agents, **not** contract-bound | 39 narrow example agents (`agents/examples/*.yaml`). But they are not deterministic contract-bound units: outputs are unvalidated (see §5, concern #1). |
| **L5 Synthesis** | Absent as cross-cluster merge | A `branch` node does author-wired fan-in producing `{merged, count}` (`dag-executor.ts:544-559`), but that is an author's explicit merge, not a governor synthesizing across clusters. |
| **L6 Telemetry + Learning** | Telemetry strong; Learning absent | Rich `runs` + `node_executions` tables (`run-store.ts:96,141`), provider trail (`usedProvider`/`attemptedProviders`/`provider_failures_json`), `SpawnProgress` events (`node-spawner.ts:162` → `progressJson`), and `planner_telemetry` + `GET /metrics/planner` (`dashboard/src/routes/metrics-planner.ts`). No learning loop, bandit, delegation policy, or objective/subjective channels. |
| **LX Task Workspace** | Absent as an object — but its *principle is already enforced* | No task-scoped blackboard with eviction. However, node context is already scoped to declared `dependsOn` upstreams via `buildUpstreamSnapshot` (`core/src/node-env.ts:183-190`); there is no shared session/accumulator (concern #12). Cross-run persistence is only the author-opt-in per-agent `STATE_DIR` (`node-env.ts:83-85`). |

---

## 3. Component compatibility (verdict + blast radius)

| Phase 2 component | Verdict | Blast radius |
|---|---|---|
| Capability-card registry (§3) | **Missing prerequisite** | New metadata layer. `agents` table has no column for it — only a **dead `provenance_json`** (`agent-store.ts:78`, never read/written). Touch: `agent-v2-schema.ts`, store schema, and every agent def to populate. |
| Multi-vector embeddings + HDBSCAN clustering (§3) | **Missing prerequisite (green-field)** | New embed pipeline + storage + clustering. No single-vector assumption to migrate *from* — it is 0→3, not 1→3 (concern #13). |
| Specificity signature / 2×2 gating (§4) | **Missing prerequisite** | Pure function once embeddings exist; depends on M0. |
| Decomposer L1 (§5) | **Missing prerequisite** at runtime | Reuse *patterns* from `build-orchestrator`, but the runtime router is new. |
| Parallel wide/narrow L2 + parallel dispatch L3 (§6, §7) | **Conflicts** | Executor is strictly sequential (`dag-executor.ts:437`, `flow-control.ts:346`). Requires reworking the scheduler to run the ready-set concurrently with cancellation — the same change as ADR-0028 "Phase 0." High blast radius in `dag-executor.ts`. |
| Governor pipeline + arbitration modes (§7) | **Missing prerequisite** | `chain` and `select_best`/`merge` are partly expressible as author DAGs (`conditional`/`branch`), but a *runtime* governor is new. |
| Disclosure picker L2.5 (§9) | **Missing prerequisite + interface change** | No HITL node, no separable retrieval, and intermediate state is an in-memory `Map` (`build-orchestrator.ts:10`). |
| Task workspace LX (§8) | **Needs adaptation / mostly redundant** | The ancestor-only *rule* is already met at node level; a mutable artifact store is only needed if artifacts must outlive a single edge. See Pushback. |
| Output contracts (throughout) | **Missing prerequisite (largest retrofit)** | Add a validated schema per agent + an executor validation seam + storage; touches every agent. Blocks M5 and §8. |
| Learning loop L6 (§10) | **Missing prerequisite** | Telemetry seams exist; policy/bandit/eval-gate are green-field. |
| Provenance + versioning fields (§3) | **Needs adaptation (cheap)** | `agent_versions` gives def-version; `author` is free-text; `provenance_json` is a ready but dead column. Model version is *not* persisted per run (concern #11). |

---

## 4. Concerns — answered in order

**1. Output contracts.** **No — this is the largest retrofit and it silently blocks M5 and §8.** Declared per-agent `outputs:` is explicitly "Documentation, not a contract: the executor doesn't enforce it" (`agent-v2-schema.ts:251-260`). Runtime capture is opportunistic: `extractFramedOutput` takes the last JSON-parseable stdout line (`output-framing.ts:25-46`) and stores it as `outputsJson` — never schema-checked (`rg -n outputs dag-executor.ts | grep -iE "valid|enforc|schema"` → nothing). The only runtime output gate is node-level `outputContract` = a **regex + min-length** on free text (`agent-v2-types.ts:308-315`, enforced `node-spawner.ts:684,1016-1030`), not a JSON schema. Fraction: of 39 examples, 12 declare an `outputs:` block; a majority emit framed JSON *by convention*; ≥9 are purely free-form (`inbox-triage`, `goal-surveyor`, `agent-catalog-search`, …). Universal adoption cost: **high** — define + validate a schema per agent, add a validation seam in the executor, and touch every agent. Until then `contract_pass` (the highest-value trace field) cannot be computed.

**2. Trace schema.** **Yes, observability is strong and a per-stage trace threads in cleanly.** `runs` (`run-store.ts:96-196`) and `node_executions` (`run-store.ts:141-259`) already persist status, timing, `errorCategory`, `inputsJson`, `upstreamInputsJson`, `outputsJson`, `progressJson`, and the provider trail (`usedProvider`, `attemptedProviders`, `provider_failures_json`, `usedWorkflowProvider`). Seams: model each routing stage as either a `node_executions` row or a **sibling table keyed by `run_id`** exactly like `planner_telemetry` (`planner-telemetry-store.ts:105`, `ON DELETE CASCADE`). The build planner already records multi-stage timing (`planner_telemetry.time_to_plan_ms`/`time_to_commit_ms`; per-phase `tookMs` in `planner-loop/runner.ts:227,241`), so the pattern is proven. **This is the "bank M1 first" item.**

**3. Governor latency / fast path.** **No existing fast path**, and the concern is amplified here. There is no routing cache, confidence gate, or short-circuit (`rg -ni confidence packages/*/src` → 0); the only short-circuit is downstream-skip after upstream failure (`dag-executor.ts:524`). Two consequences: (a) 60% Stage-0 hit rate is *unmeasurable* today because no routing exists to instrument; (b) because execution is **sequential** (concern #8), a multi-stage governor multiplied by fan-out accrues in **wall-clock series**, so a governor-per-cluster is strictly more expensive than on a parallel runtime. Realistic p50/p95 cannot be estimated from the code — flag that the latency argument for the whole architecture is untestable until both a fast path and concurrency exist.

**4. Embedding representation mismatch.** N/A literally (nothing is embedded), but the *spirit* of the concern is already live: today's LLM-catalog "routing" feeds the model a flat catalog of `id + description + input/output names` (`discovery-catalog.ts:202-236`) — pure spec language, exactly the distributional gap the design warns of. No similarity is computed, so there is no low-similarity evidence to point at. When embeddings land, `example_queries` in the capability card are the correct fix, and should be embedded into `v_capability`.

**5. Signal confounding.** **No existing feedback/scoring/eval mixes objective and subjective** — clean slate, no conflict with the V1/V2 split. `planner_telemetry` captures only objective build metrics (`plan_attempts`, `plan_validation_errors`, `smoke_run_status`; `planner-telemetry-store.ts:105`). There is no user-rating/edit signal anywhere. You get to design the two-channel separation without unwinding an existing conflated metric.

**6. Argmax routing / cold start.** No routing today ⇒ no argmax and no exploration to point at. Making a future router sample-based is unconstrained by current structure (green-field). **But a de-facto cold-start problem already exists**: the discovery catalog is **capped at 30 agents** (`discovery-catalog.ts` `buildAgentsSection`), so past 30, agents are simply invisible to the current LLM selector — ossification by truncation, before any learning.

**7. Over-engineering at scale.** Correctly *avoided* on the vector side — **no vector DB / ANN index** exists (`faiss|pinecone|hnsw|qdrant|pgvector|…` → 0), matching the §3 "in-memory matmul at hundreds of agents" guidance. Conversely, current things that will fall over at 10×: `listAgents()` does `SELECT * … ORDER BY starred DESC, name` with **no LIMIT/pagination**, deserializing all matches (`agent-store.ts:203`); MCP **rebuilds the full exposed-agent map on every tool call**, no cache (`mcp-server/src/tools.ts:51-56`); the 30-agent catalog cap silently truncates; planner memory scans a 50-row window (`memory-retrieval.ts:42-51`). (inference) None is fatal, but all assume a small registry.

**8. Concurrency reality check.** **Sequential — confirmed hard.** Main loop `for (const node of order)` awaits each node before the next (`dag-executor.ts:437`; dispatches at `:648,678,1035,1049` all `await`ed inline); topological sort emits a single linear array (`:1267-1309`); loop iterations are serial (`flow-control.ts:346,368`). No `Promise.all/allSettled/race` in the execution path (only unrelated fan-out in notify/MCP-shutdown/design-time drafters). **L2 speculative wide/narrow, L3 parallel dispatch, and DAG-parallel sub-tasks are all fiction today.** Realizing them = reworking the executor to schedule the ready-set concurrently with cancellation (= ADR-0028 Phase 0).

**9. Personalization leakage.** **None.** No user/session/tenant scoping anywhere (`rg -ni tenant packages/*/src` → 0); vars and secrets are global, single-operator (ADR-0015). Nothing session-derived reaches anything routing-like — so the shared-geometry assumption is *not* violated. Flip side (inference): there is also no scoping key on which to later hang per-user scoring weights; V2 will need to introduce one.

**10. Fan-out cost control.** **No cost/token/fan-out budget exists** (`budget|token.?limit|maxCost|maxTokens|fanout` → nothing). Ceilings are only time-based (`agent.timeoutSec` `dag-executor.ts:342-355`; per-node `timeout` `node-spawner.ts:1201-1206`), iteration-based (`loop.maxIterations` default **1000** `flow-control.ts:336`), and size-based (`stateMaxBytes` `dag-executor.ts:783-804`). Because execution is sequential, `agent.timeoutSec` is effectively the *only* aggregate governor — an ambiguous request that fans across clusters is bounded by wall-clock, not spend. A budget primitive is missing and needed.

**11. Non-stationarity.** **Partly covered, one real gap.** Agent defs are immutably versioned (`agent_versions`, `agent-store.ts:84`) and runs are pinned to `workflow_version` (`run-store.ts:287`; `node_executions.workflowVersion NOT NULL`), so weights *could* be keyed to `(agentId, workflow_version)` and invalidated on bump. **But the resolved model string and resolved prompt are not persisted per run** — `node_executions` stores `usedProvider` (`claude`/`codex`/`apple`) but no model column, and the prompt is computed at spawn (`node-spawner.ts:640-651`) and not stored. So weights tied to a *model version* have no invalidation signal. Close this in M1 (cheap now, see §6).

**12. Context bleed.** **sua does NOT violate the DAG-scoped rule — it already conforms.** `buildUpstreamSnapshot` filters to `node.dependsOn` only (`node-env.ts:183-190`); a node with no deps gets an empty snapshot. There is no shared session object, no conversation history, no accumulator: llm-prompt nodes receive only mapped inputs + declared-upstream results, and the raw `UPSTREAM_*` env vars are stripped from the child before exec (`node-spawner.ts:653-661`). Each spawn is a fresh process — no cross-node carry-over. This is a **point in sua's favor**: the §8 access rule is the de-facto model already. *One caveat:* what flows along an edge is the raw upstream result **string**, which may be free-form text — so §8's "structured contract-validated artifacts, never transcripts" is only *half* satisfied (the scoping half, not the structured half). That gap is the same as concern #1.

**13. Multi-vector migration cost.** **Moot — it is 0→3, not 1→3.** There are zero embeddings today (concern #7/§1), so there is no single-vector assumption baked in and no cached clusters to invalidate. No smearing evidence exists because no clustering runs. Recommendation stands: spec the three-vector schema from the first embedded agent (schema stickiness), but there is no migration to pay now.

**14. Provenance and versioning fields.** Partial and cheap to complete. `agent_versions` gives `version` + coarse `created_by` (`cli|dashboard|import`, `agent-store.ts:89`); `author` is free-text (`agent-v2-schema.ts:412`); **`provenance_json` is a declared-but-dead column** (`agent-store.ts:78`) — a ready home to activate. No `verified`/`trust_tier`. Add these to `agent-v2-schema.ts` and activate `provenance_json` now.

**15. Progressive disclosure feasibility.** **Not today; feasible with a real but bounded change.** Retrieval is not separable from execution — normal runs go straight request→execution (`run-now.ts:27`), and there is no HITL/pause node (`agent-v2-types.ts:30-38`), so a DAG cannot pause for a selection and resume. The two ingredients exist but only for *building*: (a) the build wizard's poll-then-commit HTTP shape (`POST /agents/build` → `GET /agents/build/:id` → `POST /agents/build/create`, `run-now-build.ts`), and (b) the inbox propose→approve loop (`docs/inbox-control-plane.md`). Minimal change: a **durable** intermediate candidate store (the build wizard's session is an in-memory `Map` with 1h TTL, `build-orchestrator.ts:10` — won't survive restart) plus a two-endpoint `/route` → `/route/:id/select` surface, or a new `select`/HITL node type.

**16. Registry mass and spread.** **Count is in range (~39, near the ~100 fixture floor) but the set is not built for geometry falsifiability.** Domains exist only in prose/`description` — there is **no machine-readable domain/taxonomy field** to key on. Of the five §12 acceptance criteria: **none is testable today** (no embeddings/clusters exist). Once M0 lands, criteria 1–2 (HDBSCAN boundaries, substitutable pairs) could be spot-checked on the existing set, but 3–4 (complementary-but-far, OOD separation) require the deliberately-designed fixture — the current examples were not authored with substitutable/complementary/uncovered structure. State plainly: **validation against the current 39 agents would not be evidence the routing works.**

---

## 5. Pushback

- **Over-engineered relative to what this codebase needs right now.** The full L1–L6 + bandit + personalization is enormous next to a system whose entire "routing" is an LLM reading 30 lines of catalog text. Defer aggressively: L6 learning (M5+), V2 personalization, and — arguably — clustering itself, which is premature at 39 agents (HDBSCAN wants the ~100-agent fixture first, which §12 already argues). The design's own sequencing discipline (fixture → geometry → feedback → generation) is right; honor it and resist building the governor before M0.5 passes.
- **Already solved by a different route — the LX workspace is largely redundant here.** sua's node-scoped `buildUpstreamSnapshot` (`node-env.ts:183-190`) already implements "an agent reads only its DAG ancestors," *without* a workspace object, eviction policy, or model call. The elaborate LX store (artifacts + LRU + summarizer overflow) is only warranted if artifacts must outlive a single edge or be pulled by non-adjacent descendants. For the common case, adopting it wholesale would **reintroduce the accumulation the current design structurally prevents.** Keep pull-only/ancestor-only; add a store only where a genuine cross-branch artifact demand appears.
- **The dependency DAG already exists as a first-class primitive.** §5/§8 treat "the sub-task DAG" as something the decomposer produces; sua already has a real `dependsOn` DAG executor with topological ordering (`dag-executor.ts:1267`). Build the decomposer to *emit into that existing shape* rather than inventing a parallel DAG model — the executor, the `branch` fan-in, and the trace table are all reusable.
- **What sua does better that the spec would regress.** Its edge-scoped, no-shared-context execution is *stricter and simpler* than the workspace-with-eviction. Adopting §8's mutable blackboard wholesale is a step **backward** on context hygiene for the DAG case. Preserve the current guarantee; treat the workspace as an opt-in for the narrow artifact-outlives-edge case only.
- **Is the similarity/dependency split (§1) right here? Yes** — and sua evidences it, since its dependency DAG is entirely independent of any (nonexistent) agent-similarity notion. The one place proximity legitimately *is* a context channel — the design's own "co-activated neighbors scratchpad" — maps onto sua's within-agent nodes sharing a `STATE_DIR`; minor, and already available.
- **Missing from the design, for this runtime specifically.** (a) A **cost/token budget** primitive (concern #10): the plan has `budget_ms`, but on a sequential runtime an unbudgeted fan-out is a wall-clock bomb. (b) **Model-version + resolved-prompt persistence** (concern #11) — without it, learned weights silently survive a model swap. (c) **Durable intermediate state** for the picker (concern #15). (d) The design assumes **async cancellation** for speculative execution (§6); sua can SIGTERM/SIGKILL a single in-flight child (`node-spawner.ts:1214-1226`) but has no notion of racing two branches and cancelling the loser.
- **Sequencing.** M0→M7 is sound, but for *this* codebase insert a **Phase 0** (executor concurrency + output-contract validation + model/prompt persistence) and recognize that M0 (cards + embeddings + clustering) is the real first buildable thing — M1 "static routing" already depends on M0 existing.

---

## 6. Path to M1

M1 = static routing (fixed thresholds, no learning) + **complete trace logging**. "Routing" presupposes a minimal registry + retrieval, so the smallest working path is:

| Step | Change | Leaves system working? | Effort |
|---|---|---|---|
| 1 | Add capability-card fields to `agent-v2-schema.ts` — `summary, does, does_not, example_queries, domain, altitude, produces, consumes, cost_tier` + `provenance{author,verified,trust_tier}` (keep `version`). All **optional/additive**; activate the dead `provenance_json` column or add `capability_json`. | Yes — no behavior change | S |
| 2 | Populate cards for the 39 example agents (author, or generate + human-review). | Yes | M |
| 3 | Embedding pipeline: embed `v_capability`/`v_domain`/`v_altitude` at import; store as blobs (new `agent_embeddings`). Hold an in-memory float32 matrix, exact cosine — **no vector DB** (§3 scale note). Rebuild on registry change. | Yes — additive | M |
| 4 | Retrieval module (pure function, no model call): cosine top-K → specificity signature (`s₁`, `Ĥ`) → 2×2 gate → routing plan. | Yes — standalone | M |
| 5 | Static router surface: `sua route "<request>"` (and/or MCP `route` tool, dashboard `/route`) that runs retrieval → picks the single narrow best (fast path only, no fan-out/governor) → invokes it via `executeAgentDag`. | Yes — new entry point beside existing ones | M |
| 6 | **Trace logging** (`routing_trace` table keyed by request id, `planner_telemetry` pattern): `registry_version, s1, Ĥ, mode, candidates_narrow, candidates_wide, selected, was_override(null@M1), contract_pass(null until §1), stage timings`. Wire from the router. | Yes | M |
| 7 | Persist **resolved model string + prompt hash** on `node_executions` (add columns). | Yes — additive | S |

Each step leaves a working system; value banks at step 6 (traces not logged are gone forever) and step 7 (non-stationarity signal is unrecoverable retroactively).

**Proposed M1 trace schema:**
```json
{
  "trace_id": "…",
  "request_id": "…",
  "registry_version": "…",
  "created_at": "…",
  "stages": {
    "retrieve": { "s1": 0.62, "Hn": 0.31, "mode": "narrow|broad|weak|ood",
                  "candidates_narrow": ["agent.id"], "candidates_wide": ["agent.id"],
                  "used": "narrow", "took_ms": 3 },
    "disclose": { "rendered": false, "depth": 0, "default": "agent.id",
                  "selected": null, "was_override": null },
    "dispatch": [ { "agent": "agent.id", "run_id": "…", "workflow_version": 4,
                    "used_provider": "claude", "used_model": "claude-…",
                    "prompt_hash": "…", "contract_pass": null,
                    "latency_ms": 380 } ]
  },
  "outcome": { "status": "completed" }
}
```

**Cheap now, expensive later — do during M1 even though not strictly required:**
- Capability-card schema fields incl. the **three vector slots** and `produces`/`consumes` (§13: schema-sticky; adding to a populated registry means re-embedding everything).
- Activate `provenance_json` / add `author + verified + trust_tier` (§14).
- Persist **resolved model + prompt hash** per `node_executions` (§11 — no retroactive recovery).
- Design **`was_override` vs accepted-default** into the trace from day one (§9 — the highest-value routing signal is unusable if the schema can't distinguish them).
- Stamp **`registry_version`** on every trace (§10.5).

---

## 7. Risk register (ranked by likelihood × cost-to-fix-later)

| # | Risk | Likelihood | Cost if deferred | Mitigation / when |
|---|---|---|---|---|
| 1 | **No machine-checkable output contracts** — blocks `contract_pass`, M5 credit assignment, and §8 artifact passing. | Certain today | High — touches every agent + executor seam | Add validated per-agent output schema during M1; start with the 12 agents that already declare `outputs:`. |
| 2 | **Sequential executor** — L2/L3 parallelism (the latency thesis) is unbuildable as specified. | Certain | High — core executor rework | ADR-0028 "Phase 0": schedule the ready-set concurrently with cancellation. |
| 3 | **Model version + resolved prompt not persisted per run** — learned weights silently persist across model/prompt changes; unrecoverable retroactively. | Certain | High (and *irreversible* for historical traces) | Add columns to `node_executions` during M1 (cheap now). |
| 4 | **No cost/token/fan-out budget** — unbounded cascade; on a sequential runtime a wall-clock bomb. | Certain | Medium-High | Add a per-request budget primitive alongside the governor. |
| 5 | **Ephemeral intermediate state** — picker/candidate set is an in-memory `Map` (`build-orchestrator.ts:10`); can't survive restart. | Certain if picker built on current shape | Medium | Durable candidate store before L2.5. |
| 6 | **Registry not built for geometry falsifiability** — no domain field; 39 agents lack deliberate substitutable/complementary/uncovered structure. | Certain | Medium | Author the §12 fixture; don't validate against the current set. |
| 7 | **Trace can't distinguish override vs accepted-default** — the top routing signal becomes unusable. | Certain if not designed in | Medium | Bake the distinction into the M1 trace schema. |
| 8 | **Discovery-catalog 30-agent cap + unpaginated `listAgents`** — silent truncation ⇒ cold-start/ossification and a scale wall. | Present now | Low-Medium | Paginate/scope reads; remove or raise the catalog cap; cache the MCP agent map. |

---

*Every claim above is grounded in the cited files; items marked `(inference)` in the working notes were reasoned from code rather than directly confirmed. Where the code alone could not settle a question (e.g. realistic governor p50/p95, concern #3), the review says so rather than guessing.*
