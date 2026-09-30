# Ask a person mid-run

An `ask` node stops a run to ask you something: approve a send, pick an option, fill in a fact only you know. The run waits, holding no process, for as long as it takes (up to a deadline). When you answer in the inbox, it carries on from that node with your answer.

```yaml
id: weekly-update
name: Weekly update
nodes:
  - id: draft
    type: llm-prompt
    prompt: Draft this week's team update from {{inputs.NOTES}}.
  - id: approve
    type: ask
    question: |
      Send this update to the team?

      {{upstream.draft.result}}
    choices: [Send, Don't send]
    timeoutHours: 24          # optional; default 72, max 720
    dependsOn: [draft]
  - id: send
    type: shell
    command: ./send-update.sh
    dependsOn: [approve]
    onlyIf: { upstream: approve, field: choice, equals: Send }
```

## What happens

1. The run reaches `approve`. The question (templates resolved, like a prompt) is recorded, the node shows **waiting**, and so does the run. Nothing is running now: no process, no model, no cost.
2. An inbox item appears: "Weekly update is asking: Send this update to the team?", with the choices as buttons and a box for your own answer. It is never auto-triaged; it's for you. The run page shows a **Waiting for your answer** banner that links to it.
3. You answer. The node completes with your answer as its `result`, plus `{{upstream.approve.answer}}` and `{{upstream.approve.choice}}` (the matching choice, or empty for a written answer, so `onlyIf` can branch on it). The run resumes from there, on the backend it would normally run on (in the dashboard, or on a Temporal worker), using the agent version it started on, with the same inputs.

A question can be answered once. If nobody answers by the deadline, the node fails as `timeout` and the run stops. **Cancel run** on a waiting run withdraws the question.

## Where it works

- Any trigger: Run now, the schedule, `sua agent run`, MCP, a chat turn. A chat turn that waits shows "Waiting for an answer" in the conversation and gets its reply once the run finishes. Over MCP, `run-agent` returns `status: "waiting"` and a note.
- Not yet inside an agent that another agent called (agent-invoke or agents-as-tools): the node fails with a clear message instead of waiting.
- `llm-prompt` and `goal` nodes ask mid-thought with the `ask-human` tool (below).

## From inside an llm or goal node: `ask-human`

List `ask-human` in a node's `tools:` and the model can ask when it needs a decision or a fact only you have:

```yaml
- id: plan
  type: goal
  goal: Plan the team offsite for {{inputs.MONTH}}.
  tools: [web-fetch, ask-human]
```

The model calls `ask-human` with `question` and optional `choices` (`"Yes | No"`). The question goes to the inbox exactly like an `ask` node's, the step stops at once (no fallback to another provider), and the run waits. When you answer, the step **starts again** with your earlier questions and answers in front of the model ("You already asked… Q: … A: …"), so it carries on rather than asking twice. What the stopped attempt spent still counts.

- Up to 3 questions per step per run; after that the tool tells the model to carry on with what it has.
- Apple Foundation Models, which can't call sua tools, runs the step without it.
- The model's earlier turns aren't kept across the pause, only the questions and answers: for work the model shouldn't redo, put an `ask` node between two steps instead.

## Notes

- Waiting time doesn't count toward the agent's `timeoutSec`.
- A waiting run's spend so far counts toward its daily [spend limit](cost.md#limits).
- Questions live in the run database (`human_questions`), so any process can answer and resume them.

Design notes: [ADR-0042](adr/0042-ask-a-person-suspend-and-resume.md).
