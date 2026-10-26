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
- `sua workflow` — lower-level agent tools: list, run, replay (`--input K=V` overrides one input; the rest are the run's own), import, export, status, logs
- `sua memory` — list, search, pin, forget (what an agent remembers)
- `sua usage` — what runs cost, by agent and provider
- `sua policy` — show, check, validate (the tool policy)
- `sua behaviors` — list, show, validate (Agent Behavior specs)
- `sua tool` — list, show, validate
- `sua examples` — install, remove, list
- `sua secrets` — set, get, list, delete, migrate, check
- `sua vars` — list, get, set, delete (global variables)
- `sua mcp` — start, rotate-token, token
- `sua schedule` — list, validate, status, start
- `sua dashboard` — start, signin-url
- `sua daemon` — start, stop, restart, status, logs (dashboard, scheduler, MCP, worker, local model server)
- `sua worker` — the Temporal worker: start, install-launchagent, launchagent-status, uninstall-launchagent
- `sua state` — list, du, export, prune (agents' saved state)
- `sua outcome` — list, show (what runs achieved)
- `sua apple` — authorize, connect (Apple Foundation Models on macOS)
- `sua planner smoke` — check the layout planner end to end
- `sua init`, `sua doctor`, `sua tutorial`

## What's new in 0.32

- **A notebook picks its own page** — a **Shortlist** to choose from, a **Meeting briefing**, or one drawn for its job; the brief prints that page.
- **Getting ready to meet someone** — a **Learn about** step finds who they are and their company (with sources, and a photo only when it's clearly them); a **Write** step has sua write the talking points.
- **Edit a notebook by talking** — **Talk**, **Prompt** (the notebook as text) and **How it looks** (looks as pictures of their pages), with a preview before you save.
- **Home** — an **Ask sua** card with starters to start a notebook, run, build, fix or look something up; **Try next**; **Notebooks** in the top bar. **Appearance** is a gallery of looks you use in one click.
- **Skills** — know-how several agents share, kept in one file (`sua skill list`); shell nodes share Python helpers.
- **The scheduler picks up changes** — a schedule you change, and an agent you edit, reach the next scheduled run within a minute, without a restart.

## What's new in 0.31

- **Notebooks work in steps** — find → source → check → decide, pausing after each; a find step with no agent of its own uses sua's finder (several narrow searches at once). Save a notebook as a **template**, share a **brief** that prints as a PDF, and change its setup on its own **Edit** page.
- **The agents catalog asks what you want to do** — `/agents` answers with keyword matches and sua's picks, shelves the agents you use, and groups the rest by what they do.
- **Pick the Codex and Claude model** from what each CLI offers your account now (Settings → LLM); sua tells you in the inbox when a model in use is retired.
- **Widgets in chat** — any agent's reply, and sua's, can include a widget, drawn as it streams, with working buttons.
- **Long searches finish** — a step out of turns answers from what it read; a loop can run items at the same time (`loopConfig.concurrency`); a step can keep going if it fails (box on its Edit page).
- **Replay with a changed input** — `sua workflow replay <runId> --from <node> --input K=V` reuses the run's other inputs.

See the [changelog](https://github.com/gregmeyer/some-useful-agents/blob/main/CHANGELOG.md) for everything, and earlier highlights: goal agents, conversations, memory, ask a person, webhooks, cost limits, tool policies, A2UI views, integrations (`/tools?tab=integrations`), Suggest a layout, MCP servers (`/tools?tab=servers`), flow control, and 40+ bundled example agents.

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) and [docs/](https://github.com/gregmeyer/some-useful-agents/tree/main/docs) for full documentation.

## License

MIT
