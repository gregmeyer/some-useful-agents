---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Read Agent Behavior specs — the open standard for writing down expected agent conduct.

sua now discovers, validates, and displays `.agents/behaviors/*/BEHAVIOR.md` files following the [Agent Behavior](https://www.agentbehavior.dev/) standard from Braintrust and Basis. A behavior spec records recurring conduct — how an agent gathers context, decides, acts, and recovers — as a written standard you can review traces against.

New `sua behaviors list | validate | show`, and a `/behaviors` page in the dashboard grouped by scope. `validate` exits non-zero on any invalid spec, so it works as a CI gate.

Specs are found in three scopes: your project, your home directory, and an optional configured org directory, resolved project-first. Two specs of our own ship under `.agents/behaviors/` as working examples.

This is a reader: sua displays and validates these, and does not grade runs against them or feed them to a model on its own. Conformance is checked against the reference implementation — both validators agree on the same trees, including which ones they reject.

Note the leading dot: `.agents/` is the shared standard directory and is unrelated to this project's own `agents/` folder. Putting specs in the undotted path produces a diagnostic naming both, rather than an empty list.
