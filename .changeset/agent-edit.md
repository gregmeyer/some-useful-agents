---
"@some-useful-agents/cli": minor
"@some-useful-agents/core": minor
---

**feat: agent lifecycle verbs — `edit`, `disable`, `enable`, `list --disabled`.** A set of small commands for the day-to-day "I want to tweak this agent without memorizing paths, or pause it without losing the YAML" flows.

### `sua agent edit <name>` — open the YAML in $EDITOR Resolves the agent name to its source file, spawns `$EDITOR` (or `$VISUAL`, falling back to `vi` on Unix / `notepad` on Windows), then re-parses and validates on save. Validation errors name the offending field and the file path so you can jump back and fix without waiting for `sua agent run` to surface the problem.

```bash
sua agent edit hello                       # open in $EDITOR
sua agent edit hello --print-path          # just print the resolved path
code "$(sua agent edit hello --print-path)"   # hand the path to VS Code
```

Under the hood, `AgentDefinition.filePath` is now populated by the loader (runtime-only metadata, not part of the on-disk schema) so `audit`, `doctor`, and any future `agent edit`-adjacent verbs have a single source of truth for "where did this agent come from." Non-TTY invocations print the path to stdout instead of spawning an editor — lets you compose with other tools without interactive state.

When the named agent isn't found but there's a matching file on disk that the loader skipped (invalid YAML, failed schema check), the error now names those files and their loader warnings so broken edits don't silently disappear from `sua agent list`.

### `sua agent disable <name>` / `sua agent enable <name>` — pause without deleting

```bash
sua agent disable claude-test    # renames to claude-test.yaml.disabled → loader skips it
sua agent list --disabled        # see what's paused
sua agent enable claude-test     # rename back
```

The loader already ignores anything that isn't `.yaml` / `.yml`, so the `.disabled` suffix is the only state change — no schema fields, no hidden files. Examples (bundled) agents refuse to disable; community agents refuse by default with `--force` to override. Disabling a scheduled agent prints a reminder to restart any running `sua schedule start` daemon so it drops the in-memory cron job.

`enable` matches on the YAML's declared `name:` field rather than the filename, so renaming the file independently of the agent name still works. Conflicts (disabling when `.disabled` already exists, enabling when a new `.yaml` has claimed the slot) refuse with a clear "resolve manually" message rather than clobbering either file.
