# @some-useful-agents/cli

Command-line interface for some-useful-agents. Author, run, schedule, and manage agents from the terminal.

## Install

```bash
npm install -g @some-useful-agents/cli
```

## Quick start

```bash
sua init                         # initialize a project
sua agent run hello              # run an agent (v1 or v2)
sua tool list                    # see available tools
sua examples install             # install bundled examples
sua dashboard start              # open the web dashboard
```

## Commands

- `sua agent` — list, new, run, chat, webhook, status, logs, cancel, audit, edit, disable/enable, install, reimport
- `sua workflow` — lower-level agent tools: list, run, replay, import, export, status, logs
- `sua memory` — list, search, pin, forget (what an agent remembers)
- `sua usage` — what runs cost, by agent and provider
- `sua policy` — show, check, validate (the tool policy)
- `sua behaviors` — list, show, validate (Agent Behavior specs)
- `sua tool` — list, show, validate
- `sua examples` — install, remove, list
- `sua secrets` — set, get, list, delete, migrate, check
- `sua vars` — list, get, set, delete (global variables)
- `sua mcp` — start, rotate-token, token
- `sua schedule` — list, validate, start
- `sua dashboard` — start, signin-url
- `sua daemon` — start, stop, restart, status (dashboard, scheduler, MCP, worker, local model server)
- `sua worker` — the Temporal worker
- `sua init`, `sua doctor`, `sua tutorial`

## What's new in 0.28

- **Goal agents** — a `goal` node gives a model a goal, tools and a budget; it works until it can answer. Build from goal drafts one for open-ended asks.
- **Agents as tools** — `agent:<id>` in a node's `tools:` lets the model call other agents.
- **Conversations** — `sua agent chat <id>`, the dashboard Chat tab (streams live), or MCP `run-agent` with a `sessionId`.
- **Memory** — `memory: true`; manage with `sua memory`.
- **Ask a person** — `ask` nodes and the `ask-human` tool pause a run for your answer in the inbox.
- **Webhooks** — `sua agent webhook <id> --on`, then `POST /hooks/<id>`.
- **Cost and spend limits** — `sua usage`, Settings → Usage, `spendLimit:`.
- **Tool policies** — enforced on every tool call; edit and test in Settings → Policies or with `sua policy`.
- **A2UI views** — describe an agent's widget as declarative UI; every widget is drawn with A2UI.
- **Codex and Claude call sua tools** over a local MCP endpoint; Codex works outside git repos.

See the [changelog](https://github.com/gregmeyer/some-useful-agents/blob/main/CHANGELOG.md) for everything, and earlier highlights: integrations (`/tools?tab=integrations`), the Improve layout wizard, MCP servers (`/tools?tab=servers`), flow control, and 40+ bundled example agents.

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) and [docs/](https://github.com/gregmeyer/some-useful-agents/tree/main/docs) for full documentation.

## License

MIT
