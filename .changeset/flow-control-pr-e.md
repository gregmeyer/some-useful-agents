---
"@some-useful-agents/core": minor
---

**feat: end + break node types — early flow termination (Flow PR E).**

- **`end` node**: terminates the entire flow cleanly when reached. Status = `completed` (not failed). All remaining nodes are skipped with `flow_ended` category. The node's `endMessage` surfaces in the run detail.
- **`break` node**: exits the current flow (loop body / sub-flow) only. Within a top-level flow it behaves like `end`; within a loop iteration it stops that iteration and the loop continues to the next item.
- Both compose with `onlyIf` — an end/break node gated by a conditional only fires when the condition is met. When skipped by `condition_not_met`, the flow continues normally.
