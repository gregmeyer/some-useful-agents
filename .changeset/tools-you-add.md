---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add your own tools: a command or a prompt, with `sua tool add <file>`.

A tool you add gets its declared inputs (defaults applied, required ones checked, undeclared ones refused). A command tool gets them as environment variables (`$url`), never pasted into the command, and a prompt tool as `{{inputs.x}}`. A model can call a command tool from an `llm-prompt` or `goal` step's `tools:` list. `sua tool remove <id>` removes one, and `sua tool show` prints its command or prompt. Saving warns about unquoted inputs, `eval`, `rm -rf`/`sudo`, and curl on an input URL.

The community shell gate now follows what actually runs a shell: a step whose `tool:` is `shell-exec` or a command tool, or whose `tools:` list offers one, needs the same opt-in as a shell step. Before, such a step ran without it.
