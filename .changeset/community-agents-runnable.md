---
"@some-useful-agents/cli": patch
"@some-useful-agents/core": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

**Fix: community agents are now runnable from the CLI so the v0.6.0 shell gate is actually reachable.** Before this patch, `sua agent run <name>` and `sua schedule start` only loaded `agents/examples/` + `agents/local/` — community agents were visible via `sua agent list --catalog` but "not found" at run time. The shell gate in `executeAgent` was effectively dead code for the primary CLI flow (it still fired for Temporal activities and `executeChain`, both tested).

Now the runtime commands load from `dirs.all` (runnable + catalog) and the shell gate enforces per-agent opt-in via `--allow-untrusted-shell <name>` exactly as the v0.6.0 docs promised.

### Behavior changes

- `sua agent run <community-agent>` is now accepted at lookup time and refuses at execute time with the expected `UntrustedCommunityShellError` message. Opt in with `--allow-untrusted-shell <name>`.
- `sua schedule start` will now fire community agents that have a `schedule:` field; the gate still refuses unaudited community shell.
- `sua mcp start` exposes community agents that have `mcp: true` in their YAML (still filtered by the opt-in flag — no behavior change for agents without it).
- `sua doctor --security` now counts community shell agents whether or not they've been copied into `agents/local/`.
- `sua secrets check <name>` now works on community agents.

### Unchanged by design

- `sua agent list` still defaults to `runnable` vs `--catalog` so users can tell their own agents apart from third-party catalog entries.
- `sua agent audit <name>` already loaded both; unchanged.

### Docs

- `docs/SECURITY.md` and `README` version labels updated from the aspirational `v0.5.1` (what the plan predicted) to `v0.6.0` (what actually shipped). Future passphrase-KEK work renumbered to `v0.7.0`.
- Version history in SECURITY.md gets a new `v0.6.1` entry documenting the gate wiring fix.

No API changes. No migration needed.
