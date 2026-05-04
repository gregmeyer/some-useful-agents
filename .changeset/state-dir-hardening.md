---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

State directory hardening.

Three additions to the `$STATE_DIR` primitive shipped in PR D, addressing the most likely operational/correctness concerns:

**1. Per-agent size cap** — new `agent.stateMaxBytes` field (default 100 MB; set 0 to disable). Pre-node check refuses to run when the dir exceeds the cap, with a clear error pointing to `sua state prune <agent>`. The node that *exceeded* the cap completes; the *next* node fails. This attributes the error to a fresh node rather than retroactively failing one that already finished.

**2. `sua state` CLI** — four subcommands for operational hygiene:
- `sua state list` — every agent with a state dir, sorted by size
- `sua state du <agent>` — per-file breakdown
- `sua state prune <agent>` — clear contents (or `--remove` the dir)
- `sua state export <agent> [path]` — `tar.gz` to path or stdout

**3. Audit trail** — additive `stateBytesBefore` / `stateBytesAfter` columns on `node_executions`. Captured per node when the agent has a state dir. Dashboard run-detail shows the delta as a small badge (`state +12 KB`) on each node when the value changed. Useful for spotting which node is growing state unexpectedly.

Implementation notes:
- `stateDirSize(id, dataRoot)` is a recursive synchronous walk; for typical agent state (a few files) it's microseconds. Symlinks are skipped (don't follow, don't count target size). Race-tolerant: silently skips files removed mid-walk.
- `stateMaxBytes` is stored as a flat column on the `agents` table (alongside `pulse_visible`, `dashboard_visible`) — operator policy that shouldn't bump the agent version when changed.
- The CLI uses system `tar` for `export` (avoids bundling a tar library for a rarely-used verb).

Live smoke confirmed: cap enforcement refuses run 2 when state from run 1 exceeded 1-byte cap (status: failed, category: setup). Audit trail captured `0 → 6` bytes on the successful first run.

Closes critical items 1, 2, 3 from the security roadmap entry added in PR D. Items 4–7 remain on the future-work list in `docs/SECURITY.md`.
