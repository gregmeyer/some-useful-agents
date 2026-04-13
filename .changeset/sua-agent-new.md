---
"@some-useful-agents/cli": minor
"@some-useful-agents/core": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

**feat: `sua agent new` — interactive agent scaffolder.** Graduates users from "I ran an example" to "I authored an agent" without hand-writing YAML. Closes the *Interactive agent creator* roadmap item.

### What it does

`sua agent new` walks through a short prompt flow:

1. **Type** — shell or claude-code (default shell)
2. **Name** — validated against `[a-z0-9-]+` at prompt time
3. **Description** — optional one-liner
4. **Command** (shell) or **Prompt + Model** (claude-code)
5. **Customize more?** — gate to the advanced fields
   - Timeout (default 300s)
   - Cron schedule (5-field; the v0.4.0 frequency cap still applies)
   - Secrets (comma-separated uppercase names; invalid ones are ignored with a warning)
   - `mcp: true` opt-in for Claude Desktop exposure
   - `redactSecrets: true` for known-prefix scrubbing of output
6. **Preview + confirm** — prints the resolved YAML, asks before writing
7. **Write** — lands in `agents/local/<name>.yaml`, chmod-safe, overwrite-guarded

Every emitted YAML is validated against `agentDefinitionSchema` *before* the file is written — if validation fails (shouldn't, given the prompt guards), the command exits 1 without side effects.

### Why now

The security PRs (v0.4.0 → v0.6.1) added fields to the schema that are easy to forget by hand: `mcp`, `allowHighFrequency`, `redactSecrets`. Having the creator land *after* those PRs means the prompt flow covers the full schema from day one, rather than being retrofitted.

### Implementation notes

- Pure `buildAgentYaml(answers)` function is exported for testing — given an answers object, it emits deterministic, validated YAML with a stable key order (identity → type → execution → scheduling → capabilities).
- Interactive flow uses `node:readline/promises`, matching the pattern already in `sua tutorial`. No new prompt-library dependency.
- The command is read-only until the user confirms at the very end, so Ctrl-C at any stage leaves the filesystem untouched.

### Tests

14 new tests in `packages/cli/src/commands/new.test.ts`:

- YAML round-trips through `yaml.parse` to the expected object (shell + claude-code minimums).
- Key order is semantic and stable.
- Optional fields are omitted when not set; `mcp: false` / `redactSecrets: false` don't clutter the output.
- Shell and claude-code fields don't leak into each other.
- Every emitted YAML parses AND validates through `agentDefinitionSchema` (parameterized across several answer shapes).
- Schedules emitted by the creator pass the v0.4.0 cron frequency cap.

176 total tests pass.

### Follow-up (not in this PR)

The tutorial's "now make your own" stage-6 wrapper — the thing that invokes this verb from inside `sua tutorial` — stays on the roadmap. It's a guided wrapper around this verb, not a new capability; making `sua agent new` a first-class verb means it's reusable outside the tutorial too.
