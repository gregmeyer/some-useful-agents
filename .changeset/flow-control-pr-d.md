---
"@some-useful-agents/core": minor
---

**feat: loop node type — iterate + invoke sub-agent per item (Flow PR D).**

A `loop` node iterates over an array from upstream structured output, invoking a sub-agent per item. Each iteration is a nested run linked to the parent. Results are collected into `{ items: result[], count: number }`.

- **Best-effort**: failed iterations record `null` in the items array; the loop itself only fails on invalid config or missing sub-agent.
- **`maxIterations`**: caps the iteration count to prevent runaway loops.
- **`ITEM` + `ITEM_INDEX` inputs**: each sub-agent invocation receives the current item as `$ITEM` and its zero-based index as `$ITEM_INDEX`.
