---
"@some-useful-agents/cli": minor
"@some-useful-agents/core": minor
---

**feat: `sua agent edit <name>` opens the YAML in $EDITOR.** Resolves the agent name to its source file, spawns `$EDITOR` (or `$VISUAL`, falling back to `vi` on Unix / `notepad` on Windows), then re-parses and validates on save. Validation errors name the offending field and the file path so you can jump back and fix without waiting for `sua agent run` to surface the problem.

```bash
sua agent edit hello                       # open in $EDITOR
sua agent edit hello --print-path          # just print the resolved path
code "$(sua agent edit hello --print-path)"   # hand the path to VS Code
```

Under the hood, `AgentDefinition.filePath` is now populated by the loader (runtime-only metadata, not part of the on-disk schema) so `audit`, `doctor`, and any future `agent edit`-adjacent verbs have a single source of truth for "where did this agent come from." Non-TTY invocations print the path to stdout instead of spawning an editor — lets you compose with other tools without interactive state.

When the named agent isn't found but there's a matching file on disk that the loader skipped (invalid YAML, failed schema check), the error now names those files and their loader warnings so broken edits don't silently disappear from `sua agent list`.
