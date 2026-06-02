# Running on Temporal

`some-useful-agents` can run agents two ways:

- **`local`** (default) — runs execute in-process inside whatever started them
  (the CLI, the dashboard daemon, the MCP server). Zero infrastructure.
- **`temporal`** — single-node agent runs are submitted to a [Temporal](https://temporal.io)
  server as durable workflows and executed by a worker process. You get
  durability, the Temporal Web UI, and retry/visibility primitives.

This page is the operator guide: start Temporal in Docker, point `sua` at it,
run a worker, and monitor it.

> **Scope note (current release).** With the dashboard on `--provider temporal`,
> a v2 DAG run-now (and scheduled run) executes as **one durable workflow per
> run** (`sua-run-<runId>`): the whole run orchestrates on a worker, so it
> **survives a dashboard/worker crash and resumes from the last completed node**.
> The interrupted node re-runs (at-least-once); completed nodes are skipped.
> v1 single-node agents continue to run as `sua-run-…` durable workflows too.
>
> **Per-agent control.** Each agent's `runOn` (Agent config → "Execution
> backend") selects `local` (in-process, lower latency) or `temporal` (durable);
> unset follows the provider default (durable under `--provider temporal`).
> Inline sub-flows (loop / agent-invoke children, build sub-agents) always run
> in-process within the durable activity.
>
> (An earlier step also offered a per-NODE workflow mode — `sua-node-…` — where
> the dashboard orchestrated and offloaded each node; the durable per-run mode
> above supersedes it for run-now / scheduled runs.)
>
> Live progress (turn / tool-use events, the inbox "thinking…" stream) is
> surfaced for Temporal runs too: the worker heartbeats its progress trail and
> the dashboard re-broadcasts it at ~1s granularity (not token-by-token, and the
> final fraction-of-a-second batch may be dropped — the run result is always
> captured).
>
> Secrets a node declares are read on the worker from the secrets file and never
> travel in the Temporal activity payload (which Temporal persists in history). A
> few non-declared sensitive env values are dropped before crossing to the worker
> rather than risk landing in workflow history; a payload-encryption codec to
> lift that limitation is a planned follow-up.

## Architecture: server in Docker, worker on the host

The Temporal **server** runs in Docker. The **worker** runs on your host —
*not* in Docker — because the worker spawns `bash` and `claude` and needs your
PATH, dev tools, and credentials. Putting the worker in a container would mean
mounting `~/.claude` and your keys into it, which defeats the sandbox. This
split is recorded in [ADR-0004](adr/0004-temporal-worker-on-host.md).

```
┌─────────────────────── Docker ───────────────────────┐
│  temporal (server)  :7233   ◄── gRPC                  │
│  temporal-db (postgres)     persists workflow history │
│  temporal-ui        :8233   ◄── browser monitoring    │
└───────────────────────────────────────────────────────┘
            ▲                         ▲
            │ submit workflow         │ poll task queue
   ┌────────┴────────┐       ┌────────┴──────────────────┐
   │ sua dashboard / │       │  sua worker start         │
   │ mcp / agent run │       │  (HOST process: shell +   │
   │ (provider=temporal)     │   claude + secrets)       │
   └─────────────────┘       └───────────────────────────┘
```

## 1. Start the Temporal stack

The repo ships a [`docker-compose.yml`](../docker-compose.yml) with three
services:

| Service | Port | Purpose |
| --- | --- | --- |
| `temporal` | `7233` | Temporal server (gRPC) — what `sua` and the worker connect to |
| `temporal-db` | `127.0.0.1:5432` | Postgres backing workflow history |
| `temporal-ui` | `8233` → container `8080` | Temporal Web UI for monitoring |

```bash
docker compose up -d
```

Confirm it's healthy:

```bash
docker compose ps          # all three Up; temporal-db (healthy)
docker compose logs -f temporal   # watch server logs
```

The Web UI is now at **http://localhost:8233**. It will be empty until you run
something.

## 2. Point `sua` at Temporal

Three ways, in precedence order (highest wins):

1. **Per-command flag:** `--provider temporal` on `sua dashboard start`,
   `sua mcp start`, or `sua agent run`.
2. **Environment:** `SUA_PROVIDER=temporal`.
3. **Config file** (`sua.config.json` in the working directory):

   ```json
   {
     "provider": "temporal",
     "temporalAddress": "localhost:7233",
     "temporalNamespace": "default",
     "temporalTaskQueue": "sua-agents"
   }
   ```

`temporalAddress` / `temporalNamespace` / `temporalTaskQueue` default to
`localhost:7233` / `default` / `sua-agents` — the values the bundled compose
file uses, so you usually don't set them.

When a server or command starts with the Temporal provider it says so in its
banner (`Run-now provider: temporal (needs \`sua worker start\`)`), and it fails
fast with a clear message if the Temporal server is unreachable rather than
hanging.

## 3. Start a worker on the host

Nothing runs until a worker is polling the task queue. In a separate terminal:

```bash
sua worker start
# Address:    localhost:7233
# Namespace:  default
# Task queue: sua-agents
# ✓ Worker connected. Listening for agent runs...
```

Leave it running (Ctrl-C stops it). Three ways to keep it up long-lived:

- **Daemon service.** The worker is a managed `sua daemon` service. Add it to
  `daemon.services` in `sua.config.json` (alongside `dashboard` / `mcp`), or
  start it directly: `sua daemon start --service worker`. `sua daemon status`
  shows it; `sua daemon stop --service worker` stops it. When
  `provider: temporal` is set in config, `sua daemon start` also passes
  `--provider temporal` to the dashboard + MCP server so the whole stack agrees.
- **One command for the whole stack.** `./scripts/temporal-up.sh` brings up the
  Temporal server (Docker), waits for health, then starts the dashboard, MCP,
  and worker on the temporal provider — and prints the sign-in URL.
  `./scripts/temporal-down.sh` tears it back down.
- **From the dashboard.** `Settings → Temporal` shows the worker's status with
  Start / Stop buttons (it manages the same daemon-tracked worker), plus the
  active provider and the Temporal connection. `launchd` / `systemd` also work.

> If you submit a Temporal run with **no worker** polling, the run sits
> `pending` — the Temporal server has accepted the workflow but nothing is
> executing it. Start a worker and it picks up immediately.

## 4. Run something

Either of these now goes through Temporal:

```bash
# CLI:
sua agent run hello-world --provider temporal

# Dashboard: start it on Temporal, then use "Run now" on a v1 agent:
sua dashboard start --provider temporal
```

## 5. Monitor

### Temporal Web UI — http://localhost:8233

The primary monitoring surface.

- **Workflows list** — every submitted run. `sua` names workflows
  `sua-run-<runId>`, so you can match them to rows in the dashboard `/runs`
  page and to `sua agent status`.
- **Status** — Running / Completed / Failed / Cancelled / Terminated.
- **Workflow detail → History** — the full event log: when the activity
  started, its input, result, retries, and any failure stack. This is where you
  look when a run failed and you want to know *why*.
- **Task queues** — open the `sua-agents` task queue to confirm a worker is
  registered (a "pollers" entry). No pollers = no worker running = runs stay
  pending.

### Command line

```bash
# List recent workflows from inside the server container:
docker exec sua-temporal temporal workflow list

# Inspect one run's full history:
docker exec sua-temporal temporal workflow show --workflow-id sua-run-<runId>

# Is a worker registered on the queue? (look for pollers)
docker exec sua-temporal temporal task-queue describe --task-queue sua-agents
```

`sua` also mirrors run status into its local SQLite store, so
`sua agent status [runId]`, `sua agent logs <runId>`, and the dashboard
`/runs` page reflect Temporal runs without opening the UI.

**Failed Temporal runs raise an inbox conversation.** Because a failure on a
remote worker (or a dashboard that died mid-run) would otherwise be easy to
miss, a failed Temporal run opens a `run-failure` thread in the dashboard inbox
— one per run — so the triage agent picks it up like any other item. Local
in-process failures don't (they're visible to whoever triggered them), and
operator-cancelled runs never raise one.

### Health at a glance

```bash
docker compose ps                       # containers up + db healthy
docker exec sua-temporal temporal operator cluster health   # server reachable
```

## Stopping and resetting

```bash
docker compose stop      # stop containers, keep workflow history
docker compose down      # remove containers, keep the postgres volume
docker compose down -v   # remove containers AND wipe all workflow history
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Could not start the temporal provider: ... ECONNREFUSED` | Temporal server not up | `docker compose up -d`, then retry |
| Runs stuck `pending` forever | No worker polling the queue | `sua worker start` in another terminal |
| Worker: `Worker failed: ... connection refused` | Server not up / wrong address | Start the stack; check `temporalAddress` |
| Web UI loads but is empty | No runs yet, or you only ran **v2 DAG agents** (which don't route through Temporal yet) | Run a v1 agent, or see the scope note above |
| UI can't reach server | `temporal-ui` env `TEMPORAL_ADDRESS` wrong | It's `temporal:7233` (container DNS), already set in compose |

## See also

- [ADR-0004 — Temporal worker runs on host, not Docker](adr/0004-temporal-worker-on-host.md)
- [docker-compose.yml](../docker-compose.yml)
- [docs/security.md](SECURITY.md) — trust boundaries are enforced at the agent
  layer, which is why host execution is acceptable
