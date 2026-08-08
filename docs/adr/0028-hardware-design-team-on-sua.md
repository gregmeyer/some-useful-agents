# ADR-0028: Hardware Design Team as a sua multi-agent system

## Status

Proposed

## Context

A hierarchical multi-agent **Hardware Design Team** already exists as a Claude
Code plugin. Its architecture:

- A **Master Design Agent** (orchestrator skill) that routes a request,
  sequences specialists along a dependency DAG, iterates on change, runs a
  compliance gate, and synthesizes the result.
- ~12 **discipline managers**: `requirements-systems`, `mechanical-cad`,
  `electrical-pcb`, `firmware-embedded`, `components-bom`, `manufacturing-dfm`,
  `reliability-risk`, `analysis-simulation`, `compliance-sme`,
  `design-director` (optional), `industrial-design-ux` (optional),
  `test-validation`.
- ~50 **sub-specialists** under those managers (e.g. `mechanical-cad` →
  `enclosure-architect`, `gdt-tolerance-specialist`, `sealing-ingress`,
  `materials-finish`, `fastening-joining`, `surfacing-detailing`).
- Shared **skills**: `design-state` (versioned blackboard + conflict/decision/
  sign-off log), `hardware-kb` (canonical rules/standards/materials),
  `design-language` (aesthetic profiles → CAD directives), `cross-check`
  (red-team via Grok/Gemini through the `model-proxy` MCP).
- **Tools**: Zoo CAD (KCL) via MCP; `model-proxy` for Grok/Gemini.
- Sub-agents can run **in parallel** (Claude Code dispatches many at once).

The goal is to recreate this on **sua** to gain: durable + replayable runs,
a visual dashboard of the whole DAG with per-node logs, output-widget
presentation of the final design package, cron scheduling, the provider
waterfall, and orchestration expressed as explicit code rather than
model-decided routing.

**Load-bearing constraint discovered in the source:** sua's executor is
**strictly sequential**. `dag-executor.ts:437` walks nodes in a `for…of`
topological loop awaiting each; `flow-control.ts:346` runs `loop` iterations
serially; `agent-invoke` is a single serial sub-run. There is **no concurrency
inside a run today.** Ported as-is, the ~60-agent team runs one agent at a
time — correct, but slower than the parallel plugin. "Faster" therefore is not
a property sua confers for free; it requires the executor change in §6.

Two further prerequisites: (a) an authenticated LLM provider — every specialist
is an `llm-prompt` node and will fail like `inbox-triage` without one; (b) the
Zoo CAD and `model-proxy` MCP servers, which live in the Claude session, must be
imported into sua's own MCP registry with a transport sua can reach (see
[ADR-0003](0003-mcp-http-sse-transport.md), [ADR-0019](0019-mcp-servers-first-class.md)).

## Decision

Recreate the team on sua with the following architecture.

### 1. Specialist = agent; orchestrator = DAG agent

Each plugin agent becomes a **sua agent** whose primary node is an agentic
`llm-prompt` ([ADR-0023](0023-llm-prompt-unification.md)) carrying that
specialist's ported system prompt, with `maxTurns` and a scoped `allowedTools`
(the relevant MCP tools + builtins). A sua `llm-prompt` node *is* an agentic
Claude run, so one node ≈ one plugin sub-agent. Managers `agent-invoke` their
sub-specialists; the Master is a DAG that `agent-invoke`s the managers.

### 2. Agent roster + dependency DAG

Managers, in the topological order the Master enforces (→ = "must precede"):

```
requirements-systems
   └─→ compliance-sme (standards baseline + domain-risk read, early pass)
         └─→ mechanical-cad (owns geometry envelope — everyone downstream needs it)
               ├─→ electrical-pcb
               ├─→ firmware-embedded      (co-designs pinout with electrical-pcb)
               ├─→ components-bom
               ├─→ industrial-design-ux    (optional; user-facing products)
               └─→ design-director         (optional; art direction + CMF)
   analysis-simulation   (depends on mechanical + electrical: thermal/mass/tolerance vs budgets)
   reliability-risk      (FMEA — prerequisite for a compliance PASS)
   manufacturing-dfm
   test-validation       (verification matrix — prerequisite for a compliance PASS)
         └─→ compliance-sme (FINAL GATE: PASS / PASS-WITH-NOTES / BLOCK)
               └─→ Master synthesis (assemble the design package)
```

Sub-specialists hang off each manager and are invoked by it (via `agent-invoke`
for a fixed set, or `loop` over a list when the manager decides which to run).
Example: `electrical-pcb` → `power-supply`, `power-integrity`,
`signal-integrity`, `rf-antenna`, `emc-emi`, `electrical-protection`.

### 3. `design-state` as a shared JSON blackboard

Per-agent state dirs are keyed by agent id, so they do **not** share across
`agent-invoke` boundaries. Instead, use a single JSON document at a fixed path
(e.g. `data/agent-state/design-state/state.json`), read/written by the
`file-read` / `file-write` / `json-parse` / `json-path` builtins. Each
specialist reads it on entry and writes only its section on exit; the Master
merges via `branch` fan-in nodes. Proposed schema:

```json
{
  "version": 7,
  "product": { "name": "", "class": "", "markets": ["US", "EU"] },
  "requirements": { "functional": [], "interfaces": [] },
  "budgets": { "power_mW": null, "thermal_C": null, "mass_g": null,
               "size_mm": [null, null, null], "cost_usd": null },
  "sections": {
    "mechanical": {}, "electrical": {}, "firmware": {}, "components": {},
    "analysis": {}, "reliability": {}, "manufacturing": {},
    "test": {}, "design_direction": {}, "human_factors": {}
  },
  "conflicts": [
    { "id": "", "between": ["", ""], "field": "", "detail": "", "status": "open" }
  ],
  "decisions": [
    { "id": "", "by": "", "summary": "", "rationale": "", "ts": "" }
  ],
  "signoffs": [ { "gate": "", "verdict": "", "by": "", "ts": "" } ],
  "gate": { "verdict": null, "notes": [] }
}
```

Because sua serializes writes, the classic blackboard write-race disappears —
serial execution is, for this one concern, a feature.

### 4. Master DAG topology (sua nodes)

- `agent-invoke` nodes for each manager, wired with `dependsOn` to encode §2.
- `branch` nodes to fan requirements out to the parallel-eligible disciplines
  and to fan them back in before analysis.
- The **compliance gate** is a `switch` on the gate agent's `verdict`:
  `PASS`/`PASS-WITH-NOTES` → continue to synthesis; `BLOCK` → `end` the run
  with the blocking reasons surfaced.
- **Critic loops** (e.g. design-director's aesthetic critique, or re-work after
  a budget miss) use a `loop` or a `conditional` that re-invokes the specialist
  until a predicate clears or a max-iteration cap trips.
- Final `llm-prompt` synthesis node assembles the design package; an
  `ai-template` **output widget** renders it (budgets table, BOM, gate verdict,
  CAD snapshots) on the dashboard.

### 5. MCP + provider wiring

- Import **Zoo CAD** and **`model-proxy`** as MCP servers in
  `/settings/mcp-servers`; grant each specialist only the tools it needs via
  `allowedTools`.
- Pin design work to Claude via `provider:`; **cross-check** nodes call
  `model-proxy` (`ask_grok` / `ask_gemini`) or pin an alternate provider.
- Store API keys in the encrypted **secrets** store
  ([ADR-0007](0007-encrypted-file-secrets-store.md)); reference `hardware-kb`
  and `design-language` canon as read-only files injected via `file-read`.

### 6. Parallelism plan (enabling framework change)

To make the "faster/efficient" thesis real, add **concurrent execution** to the
executor as a separate, tested change (its own ADR + changeset):

- Group the topological sort into **levels** (nodes whose `dependsOn` are all
  satisfied) and execute each level with `Promise.all` under a concurrency cap.
- Optionally run `loop` iterations with bounded concurrency.
- Preserve per-node persistence, orphan reaping, cancellation, and the
  wall-clock `timeoutSec` ceiling. Determinism of *results* is unaffected;
  only scheduling changes.

This is the highest-leverage item: it benefits every fan-out agent, not just
the hardware team, and it is what turns ~60 serial specialists into a fast
parallel design run.

### 7. Phased build order

- **Phase 0** — parallel executor (§6). Recommended first; unblocks speed.
- **Phase 1** — vertical slice: Master + `design-state` store +
  `requirements-systems` + `mechanical-cad` + `compliance-sme` gate. Proves the
  full mapping end-to-end.
- **Phase 2** — remaining managers: electrical, firmware, components, analysis,
  reliability, manufacturing, test-validation.
- **Phase 3** — sub-specialists per manager (`agent-invoke`/`loop`).
- **Phase 4** — `cross-check`, `design-director` + `industrial-design-ux`,
  and the design-package output widget.
- **Phase 5** — package it as a sua **widget pack**, add scheduling, dashboards.

## Consequences

**Positive**

- Durable, replayable, observable runs; a visual DAG and per-node logs; a
  rendered design-package widget; cron scheduling; provider flexibility.
- Specialists are first-class reusable agents, composable beyond this team.
- Serialized `design-state` writes eliminate blackboard write-races.

**Negative / risks**

- **Serial until Phase 0 lands** — without the parallel executor the team is
  correct but slower than the plugin.
- **Authoring cost** — ~60 agents; mitigated by the phased slice and by porting
  system prompts near-verbatim from the plugin.
- **MCP parity** — Zoo CAD and `model-proxy` must be reachable over a transport
  sua supports; if they are stdio-only in the Claude session, a bridge is
  needed.
- **Cost/latency** — many agentic `llm-prompt` runs per design; the provider
  waterfall and `maxTurns` caps bound it.
- **Structure vs autonomy** — sua's explicit DAG is more constrained than the
  plugin's model-decided dispatch; a benefit for reproducibility, a limit for
  open-ended exploration.

**Alternatives considered**

- **Keep it as a Claude Code plugin** — fastest today (parallel), but no
  durability, dashboard, scheduling, or reusable-agent story.
- **`build-from-goal`** to auto-generate the agents — too coarse to produce ~60
  structured, dependency-wired specialists with shared state.
- **One mega-agent** with all disciplines inline — loses modularity, reuse,
  and per-discipline observability.
