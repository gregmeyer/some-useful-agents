# Goal agents

Most sua agents are **flows**: steps you write in advance, run in order. A **goal** step
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

## When to use a goal step (and when not)

| Use a **goal** step when… | Use a **flow** of `llm-prompt` / `shell` steps when… |
|---|---|
| the ask is open-ended: find, compare, research, figure out | the job is the same every time (fetch → format → alert) |
| the steps depend on what the model discovers | you need it cheap, fast, and predictable |
| a fixed flow would have to guess how many pages to read | you want to see and control each step |

Goal steps and flows mix: a goal step is one step in a flow, so it can take
`{{upstream.X.result}}` from earlier steps and feed later ones.

## Fields

| Field | Required | Meaning |
|---|---|---|
| `goal` | yes | What to achieve, in plain language. Templates (`{{inputs.X}}`, `{{upstream.X.field}}`) resolve like a prompt's. |
| `tools` | yes (≥1) | What it may call: builtins (`web-fetch`, `web-scrape`, `http-get`, …), integration tools, imported MCP tools, and other agents as `agent:<id>` ([agents-as-tools.md](agents-as-tools.md)). A goal with no tools is just a prompt; use `llm-prompt` for that. |
| `budget.maxTurns` | no | How many model turns it may take (1–50, default 15). |
| `budget.timeoutSec` | no | Wall-clock limit for the step (default 600). |
| `provider`, `model` | no | As for `llm-prompt`. It needs a provider that can call tools: claude or an OpenAI-compatible model (e.g. a local Qwen). Others are skipped. |

For a limit on the **whole** run, set the agent-level `timeoutSec:`.

## How it finishes

The model is told to end with its answer inside `<final>…</final>`. That block becomes the
step's result:

- If the agent declares `outputs:`, the model is asked for a JSON object with those
  fields inside `<final>`, so `{{upstream.research.picks}}`, widgets and signals work as usual.
- If the loop ends **without** `<final>` (it used all its turns, hit its time limit, or the
  model stopped early), the step fails as **Ran out of budget** (`budget_exhausted`) and says
  which limit it hit. A half-finished answer is never passed downstream as if it were done.
  To fix it, raise the budget, narrow the goal, or split it into smaller goal steps.

## Seeing what it did

Every tool call the goal step makes is on the run page under **tool calls**, with its
arguments, result and timing, whichever provider did the work. Tool policies
([tool-policies.md](tool-policies.md)) apply to every call.

## Editing

For now the dashboard's step editor handles `shell` and `llm-prompt` steps. Edit goal steps
in the agent's **YAML** tab. The editor sends you there.
