# Agents as tools

Any step that lets a model call tools can also let it call **other agents**. Put
`agent:<id>` in the step's `tools:`:

```yaml
nodes:
  - id: ask
    type: llm-prompt          # or type: goal
    prompt: What's on Hacker News right now? Pick the 3 stories most relevant to local-first software.
    tools: [agent:hn-top-stories-rich, web-fetch]
    maxTurns: 6
```

The model sees each agent as a tool, described by the agent's `description`,
`entryConditions`, `nonEntryConditions` and `sampleQuestions`, with the agent's
declared `inputs:` as the tool's parameters. When it calls one, sua runs that
agent and hands its result back to the model.

## What a call does

- It runs the agent as a **sub-run** of the calling run, recorded with the calling
  run and step. The calling run's page lists its **sub-runs**, and each sub-run links
  back with **Called by**.
- The call appears in the step's **tool calls** list, with a link to the sub-run.
- Cancelling the calling run cancels its sub-runs.
- It works on every provider that can call tools (claude, OpenAI-compatible models),
  and on a Temporal worker.

## Limits

A call is refused (the agent isn't offered to the model) when:

| Rule | Why |
|---|---|
| The agent doesn't exist or isn't `active` | Paused and archived agents don't run. |
| The agent is already in the call chain | No cycles: A → B → A is refused. |
| The chain is already 3 calls deep | Keeps delegation from fanning out without bound. |
| The caller declares `allowedSubAgents` and the agent isn't on it | An explicit allowlist, when you want one. |

Refusals are logged with the reason (`[agent-tools] agent:x not offered: …`).

[Tool policies](tool-policies.md) apply too: rules can match `agent:*` or
`agent:<id>`, e.g. `{ "tool": "agent:*", "effect": "deny", "conditions": { "source": ["community"] } }`.

## Agents as tools vs `agent-invoke`

`agent-invoke` (and `loop`) steps call another agent at a fixed point you wire into
the flow. An `agent:<id>` tool lets the **model** decide whether, when and how often
to call it. The depth and cycle limits above apply to agent tools.
