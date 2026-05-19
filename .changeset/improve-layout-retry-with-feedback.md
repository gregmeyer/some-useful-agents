---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add "Retry with feedback" on the Improve-layout error screen.

When the layout-planner emits an invalid plan (or the run fails for any other reason), the modal's error screen now offers:

- The error message (plus a `<details>` block exposing the raw planner output, if any)
- A bulleted list of schema-validation issues when applicable
- A **Feedback for the planner** textarea, pre-filled with the validation issues as a hint
- A **Retry with feedback** button

Clicking retry re-runs the planner with the combined focus:

```
<original focus>

Previous attempt failed validation. Issues:
  - <issue>
  - <issue>

User feedback:
  <textarea value>
```

So the LLM sees exactly what schema rules it broke + the user's correction. Same mechanism the post-plan questions UI uses for clarifying answers.
