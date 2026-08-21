---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Let an agent be steered by the behaviors it declares.

An agent can now list `behaviors: [declare-blind-spots]` in its YAML. Each named spec's body is prepended to every `llm-prompt` node as conduct guidance, framed so the model reads it as standards for how to work rather than as the task itself.

Opt-in only: discovering a behavior never steers anything, and only specs in this project's `.agents/behaviors/` can condition a run. One in your home directory or an org registry stays readable but cannot gain authority over your agents by being present.

Failures are loud. A name that does not exist, resolves outside project scope, or exceeds the injection budget fails the run before any node executes rather than quietly running unconditioned — output that silently lacked its standards is not detectable afterwards.

Template syntax inside a behavior body is never expanded, so a `{{inputs.API_KEY}}` written into a spec stays literal instead of interpolating a secret. Runs record which behaviors conditioned them, so a trace can be audited against the names you wrote.
