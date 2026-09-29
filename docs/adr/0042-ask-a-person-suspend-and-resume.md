# ADR-0042: Ask a person by suspending the run, and resume it from the answer

- Status: accepted
- Date: 2026-09-29
- Deciders: Greg Meyer

## Context

Agents couldn't stop for a person's decision: a flow that drafts and then sends had no place
for "approve first", so it either sent without asking or wasn't automated. The owner chose
**suspend and resume** (a run can wait hours or days without holding a process) and
**answering in the inbox**.

The executor already resumes a run in place (`resume: true`: reuse the run row, skip completed
nodes, re-run from the first incomplete one), for Temporal crash recovery.

## Decision

- **A new node type, `ask`** (`question`, optional `choices`, `timeoutHours`, default 72). The
  first time the executor reaches it, it records a question (`human_questions`), writes the node
  as `waiting`, raises an inbox item (source `question`, high priority, never auto-triaged), sets
  the run to a new status **`waiting`** and returns. Later nodes aren't written.
- **The answer resumes the run** through the existing resume path: the ask node finds its
  answered question and completes with `result` = the answer and outputs `{ answer, choice }`.
  Expired and cancelled questions fail the node (`timeout`, `cancelled`) the same way, so there
  is one code path for every outcome.
- **What a resume needs is stored on the run** (`resume_context_json`: inputs and a chat turn's
  conversation block), and a resume uses **the agent version the run started on**.
- **Where it runs:** the dashboard answers and resumes on the run's normal backend
  (`submitDagRun` with `resume` on Temporal reuses the row and restarts `sua-run-<id>`; locally,
  in process). A dashboard sweeper expires overdue questions and raises inbox items that a
  process couldn't create.
- **Not inside called agents yet**: a sub-run can't suspend without its caller suspending too,
  so the node fails with a clear message.

## Alternatives rejected

- **Block inside a tool call** until answered: holds a process (and for claude, a session) for
  hours; dies with a restart.
- **A separate "approval" feature on the inbox's action cards**: those approve triage's proposed
  actions, not an author's flow step, and couldn't carry an answer back into a run.
- **Re-running the whole agent with the answer as an input**: repeats work (and cost) done before
  the question, and loses the run's history.

## Consequences

- `RunStatus` and `NodeExecutionStatus` gain `waiting`; everything that waits for "done" treats
  it as not running (no polling, not reaped).
- A sequential executor stops at the ask node, so independent branches also wait.
- llm/goal nodes asking mid-thought (an `ask-human` tool) is the next step (E1b): it re-runs the
  node with the question and answer in its prompt, on the same suspend/resume path.
