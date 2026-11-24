# 0102. Tools you add: inputs as environment variables, gated as the shell they run

- Status: accepted
- Date: 2026-11-24

## Context

The tool store could hold a command (`implementation.type: shell`) or a prompt (`llm-prompt`) tool, but nothing put one there, and one that got there didn't work: a `tool:` step ran the command with none of its inputs, and a model's `tools:` list silently dropped it. The community shell gate looked at a step's `type:`, so `type: llm-prompt` with `tool: <a command tool>` (or `shell-exec`) started a shell without it, and a community agent's model could call `shell-exec` from `tools:`.

## Decision

- **A tool you add is a command or a prompt.** `sua tool add <file>` (and, later, the dashboard) saves it from YAML, always as `source: local`. Its id can't be a built-in's or an MCP-imported tool's. MCP tools still come in through Import.
- **Only declared inputs are accepted.** Defaults fill gaps; a missing required input, or one the tool doesn't declare, fails the step as `input_resolution` (or is reported back to the model). Values are strings by then: numbers and booleans as text, anything else as JSON, each at most 32,000 characters.
- **A command tool gets its inputs as environment variables named as declared (`$url`), never pasted into the command.** Input names must be valid variable names, and may not be ones the environment or sua uses (`PATH`, `HOME`, `LD_*`, `*_proxy`, `UPSTREAM_*`, `SUA_*`, … in any case). An input may not replace a secret the calling step declared. Saving warns about an unquoted `$input`, `eval`, `rm -rf`/`sudo`, and curl or wget on an input URL (which skips `http-get`'s address check).
- **A prompt tool gets `{{inputs.x}}` replaced in its prompt.** It runs as the whole step: it doesn't inherit the calling step's `tools:`.
- **A model can call a command tool.** The spawner builds the runner (`runCommandTool`), so `llm-tool-dispatch.ts` still never imports it, and the Temporal worker gets it too. The tool runs in the sua process's spawner with the calling step's environment, its declared secrets included, the same as the step's own shell would (served to CLI providers over the ADR-0036 endpoint).
- **A model can't call a prompt tool yet.** That's a model call inside a model call, with its own provider order, budget, usage and recursion to handle. The tools picker doesn't offer one.
- **The gate follows what runs.** A step runs a shell when it's a shell step, its `tool:` is `shell-exec` or a command tool, or its `tools:` list offers one. A community agent that isn't allowed shell is refused (`setup`) before such a step starts.

## Consequences

- `docs/tools.md` describes writing one. A tool policy can deny a tool by id; its `resources` still don't match a tool you added (it has no URL or path to match).
- There's no version history for tools yet: saving again replaces the tool.
- The dashboard's New tool form, Try it, and sua drafting a tool from a description build on `saveUserTool` and `checkUserToolYaml`.
