---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

`$STATE_DIR` primitive for stateful agents.

Agents that need to persist data across runs (diff-over-time, caches, last-fired markers) get a per-agent directory at `data/agent-state/<agent-id>/`. Created lazily on first use, chmod 0o700, removed automatically when the agent is deleted.

Available as:
- `$STATE_DIR` env var in shell nodes (and as a string in any built-in tool input)
- `{{state}}` template token in claude-code prompts and built-in tool inputs (e.g. `file-write`'s `path:`)

```yaml
nodes:
  - id: diff
    type: shell
    command: |
      mkdir -p "$STATE_DIR"
      PREV="$STATE_DIR/last-readme.md"
      NEW="$STATE_DIR/current-readme.md"
      echo "$UPSTREAM_FETCH_RESULT" > "$NEW"
      if [ -f "$PREV" ] && ! diff -q "$PREV" "$NEW" > /dev/null; then
        echo '{"changed":true}'
      fi
      cp "$NEW" "$PREV"
```

Promotes the convention agents had been inventing by hand (`.sua/state/<id>/`) into a first-class primitive. Surfaced by Round 2 dogfood Bug 8: the README diff agent invented its own state convention, and downstream agents would each invent a different one.

**Cascading delete**: `agentStore.deleteAgent(id)` now also removes `data/agent-state/<id>/`. Idempotent (no-op when the dir was never created). State is **not** swept by the run-retention timer — it persists until the agent is deleted.

**New `DagExecutorDeps.dataRoot`**: optional. When set, the executor exposes the state dir; when absent, `$STATE_DIR` is unset and `{{state}}` resolves to empty string. Tests and one-shot CLI runs typically omit it. Production paths (dashboard run-now / build / replay / widget-run, `sua workflow run` / `replay`) thread it through automatically.

**Known limitation**: `sua schedule start` uses the v1 chain executor (via `LocalProvider`), not the DAG executor — scheduled agents going through that path don't get `$STATE_DIR` yet. The migration to the v2 path will pick this up.

Sandbox: agent ids are validated against the lowercase+hyphens regex before path resolution; `removeStateDir` re-checks for defense in depth.
