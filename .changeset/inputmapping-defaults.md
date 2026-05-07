---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

`{{inputs.X}}` in `loop` / `agent-invoke` `inputMapping` now resolves YAML-declared input defaults.

The dashboard's run handler builds `options.inputs` from `input_*` form fields only — it does not merge in the agent's declared `inputs:` defaults. Per-node env construction applies defaults later, so single-node agents always saw their defaults. But composition node types (`loop`, `agent-invoke`) resolve `{{inputs.X}}` at the control-flow layer using `parentOptions.inputs` directly — which contained user-supplied values only.

Effect: when a user ran a parent agent without supplying every declared input, any composition node referencing `{{inputs.X}}` for an unsupplied X passed empty string to the sub-run. The orchestrator's loop fanned out N times with empty `JOB_QUERY` even though the YAML declared a default.

Both call sites now merge `parentAgent.inputs[*].default` into the resolved map before substitution, with user-supplied values still winning.
