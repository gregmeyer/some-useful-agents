# Goal agents

Most sua agents are **flows**: nodes you write in advance, run in order. A **goal** node
is different. You say what you want, give it tools and a budget, and the model works
it out: it decides what to do next, calls a tool, reads what came back, and repeats
until it can answer or runs out of budget.

```yaml
id: shoe-scout
name: Shoe scout
status: active
source: local
version: 1
outputs:
  picks:   { type: string, description: The three picks, one line each. }
  sources: { type: array,  description: URLs actually read. }
nodes:
  - id: research
    type: goal
    goal: |
      Find the 3 best-reviewed trail running shoes under {{inputs.BUDGET}}
      and say why each made the list.
    tools: [web-fetch, web-scrape]
    budget:
      maxTurns: 15      # default 15, max 50
      timeoutSec: 600   # default 600
inputs:
  BUDGET: { type: string, default: "$150" }
```

## When to use a goal node (and when not)

| Use a **goal** node when… | Use a **flow** of `llm-prompt` / `shell` nodes when… |
|---|---|
| the ask is open-ended: find, compare, research, figure out | the job is the same every time (fetch → format → alert) |
| the steps depend on what the model discovers | you need it cheap, fast, and predictable |
| a fixed flow would have to guess how many pages to read | you want to see and control each node |

Goal nodes and flows mix: a goal node is one node in a flow, so it can take
`{{upstream.X.result}}` from earlier nodes and feed later ones.

Try it: the **Work something out** starter (`starter-goal`, on `/start`) is a one-node
goal agent that answers a specific question from pages it chooses to read.

## Fields

| Field | Required | Meaning |
|---|---|---|
| `goal` | yes | What to achieve, in plain language. Templates (`{{inputs.X}}`, `{{upstream.X.field}}`) resolve like a prompt's. |
| `tools` | yes (≥1) | What it may call: builtins (`web-fetch`, `web-scrape`, `http-get`, …), integration tools, imported MCP tools, and other agents as `agent:<id>` ([agents-as-tools.md](agents-as-tools.md)). A goal with no tools is just a prompt; use `llm-prompt` for that. |
| `budget.maxTurns` | no | How many model turns it may take (1–50, default 15). |
| `budget.timeoutSec` | no | Wall-clock limit for the node (default 600). |
| `provider`, `model` | no | As for `llm-prompt`. It needs a provider that can call tools: claude, codex, or an OpenAI-compatible model (e.g. a local Qwen). Apple Foundation Models is skipped. |

For a limit on the **whole** run, set the agent-level `timeoutSec:`.

## How it finishes

The model is told to end with its answer inside `<final>…</final>`. That block becomes the
node's result:

- If the agent declares `outputs:`, the model is asked for a JSON object with those
  fields inside `<final>`, so `{{upstream.research.picks}}`, widgets and signals work as usual.
- If the loop ends **without** `<final>` (it used all its turns, hit its time limit, or the
  model stopped early), the node fails as **Ran out of budget** (`budget_exhausted`) and says
  which limit it hit. A half-finished answer is never passed downstream as if it were done.
  To fix it, raise the budget, narrow the goal, or split it into smaller goal nodes.

## Seeing what it did

On the run page, a goal node's header shows what it has used of its budget: while it runs, *turn 6 of 15 · 4 tool calls · 2:10 of 10:00*; once done, *6 of 15 turns · 4 tool calls · 2:10*. (Turns are counted from the provider's own signals; Codex doesn't report turns, so for it you see tool calls and time.) If it runs out, the node says which limit it hit, turns, time, no final answer, or the spend limit, and links to where you change it: **Raise the budget** opens the goal form. Agents it called as tools are listed under **sub-runs**, indented as a tree when those agents called others.

Every tool call the goal node makes is on the run page under **tool calls**, with its
arguments, result and timing, whichever provider did the work. Tool policies
([tool-policies.md](tool-policies.md)) apply to every call.

## Editing in the dashboard

- **Add:** on an agent's **Add node** page, pick **Work toward a goal** (a quick-start
  pattern, or *Work toward a goal (goal)* in the dropdown). Fill in the goal, tick the tools it
  may use, and optionally set the budget and a provider/model.
- **Edit:** click the node (or **Edit** on the Overview's Goal card for a one-node goal agent)
  to change the goal, tools, budget or provider. Switching the dropdown to another node type
  turns it into that type.
- **Tools picker:** a searchable checklist of sua tools (builtins, integration and imported MCP
  tools) and your other agents (as `agent:<id>`), each with a one-line description. Selected
  tools are listed first. A tool your [tool policy](tool-policies.md) blocks for this agent says
  so on its row. `llm-prompt` nodes use the same picker for the tools their model may call.
- The agent diagram shows goal nodes as teal hexagons, and the Overview's **Agent calls**
  lists agents a goal node may call as tools.

The YAML tab still works for everything, including fields the form doesn't show.
