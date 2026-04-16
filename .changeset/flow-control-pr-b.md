---
"@some-useful-agents/core": minor
---

**feat: conditional + switch node dispatch in executor (Flow PR B).**

First-class `conditional` and `switch` nodes now execute in the DAG. Both run in-process (no child process, no env resolution) and produce structured outputs that downstream nodes consume via `onlyIf` predicates.

- **`conditional`**: evaluates a predicate (`equals`, `notEquals`, `exists`) against the first upstream's output field. Outputs `{ matched: boolean, value: unknown }`. Downstream nodes gate on `onlyIf: { upstream: check, field: matched, equals: true }`.
- **`switch`**: matches an upstream field against named cases. Outputs `{ case: string, value: unknown }`. Unmatched values default to `"default"`. Downstream nodes gate on `onlyIf: { upstream: route, field: case, equals: "pro" }`.
- Both compose with the `onlyIf` conditional edges from PR A for full if/else and multi-branch routing patterns.
