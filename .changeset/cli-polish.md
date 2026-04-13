---
"@some-useful-agents/cli": minor
"@some-useful-agents/core": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

**feat(cli): visual polish pass across every command.** One voice, one look. No behavior changes, no API changes.

### What shipped

- **New `packages/cli/src/ui.ts`** — shared helpers (`ui.ok`, `ui.fail`, `ui.warn`, `ui.info`, `ui.step`, `ui.section`, `ui.banner`, `ui.outputFrame`, `ui.kv`, inline helpers `ui.agent`/`ui.cmd`/`ui.dim`/`ui.id`). Every command now routes its status lines through these helpers instead of reaching for `chalk.green/red/yellow` directly.
- **Unified emoji symbol set** — ✅ success, ❌ failure, ⚠️ warning, 💡 info, 🚀 next-step. Tutorial's 🎭 dad-joke flourish preserved. Output looks the same whether you run `sua init`, `sua doctor --security`, or `sua agent new`.
- **Boxed daemon banners** — `sua mcp start`, `sua schedule start`, and `sua worker start` now print a `boxen` banner with the config details instead of loose dim-text lines. Adds one new dep (`boxen@^8`, ~8KB, no surprises).
- **Custom top-level `sua --help`** — now includes an Examples block and pointers to `docs/SECURITY.md` + the repo. `showHelpAfterError(true)` so unknown commands print help automatically.
- **Unified output frame** — `sua agent run` and `sua agent logs` both wrap captured stdout in `╭── output ──╮ / ╰────────────╯` (was duplicated ad-hoc dim dashes in both files).
- **`sua agent audit` key/value rows** go through `ui.kv()` instead of a command-local `row()` helper.
- **`STATUS_COLORS` centralized** — moved from `commands/status.ts` to `ui.ts` so `status`, `schedule`, and future surfaces agree on what color a `running` / `pending` / `failed` run is.

### Files touched

**New:**
- `packages/cli/src/ui.ts`
- `packages/cli/src/ui.test.ts` — 20 tests, pure stdout capture, covers every helper.

**Modified (every command):**
- `packages/cli/package.json` — add `boxen` dep
- `packages/cli/src/index.ts` — Examples block + `showHelpAfterError`
- All 13 command files: `init.ts`, `list.ts`, `status.ts`, `run.ts`, `cancel.ts`, `logs.ts`, `mcp.ts`, `schedule.ts`, `worker.ts`, `secrets.ts`, `doctor.ts`, `audit.ts`, `new.ts`, `tutorial.ts`

### Tests

196 total (was 176; +20 new in `ui.test.ts`). Zero existing tests changed — the polish doesn't alter any assertable behavior. Lint + build clean.

### User-visible diffs

- Every success line is now `✅  Created foo.yaml` instead of green-only `Created foo.yaml`.
- Every error line is `❌  Agent "foo" not found.` instead of `Error: Agent ...` / bare red.
- Every warning is `⚠️  ...` instead of `Warning: ...`.
- `sua mcp start` / `sua schedule start` / `sua worker start` print a cyan-bordered banner with host/port/paths.
- `sua --help` ends with an Examples block.
- Run output is framed in a unicode box.

If you were grepping command output in scripts (you shouldn't be), those strings changed. No machine-readable output was altered (JSON / tables / exit codes are all identical).

### Non-goals

Deferred — not in this PR:
- Switching `readline/promises` → `@inquirer/prompts` for `sua agent new` / `sua tutorial` (UX shift, separate design pass).
- Timing info on `sua agent run` (`"completed in 2.3s"`).
- Progress bars for long chains.
- Themeable colors via config.
