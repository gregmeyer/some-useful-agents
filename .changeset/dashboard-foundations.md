---
"@some-useful-agents/core": minor
"@some-useful-agents/mcp-server": patch
---

**feat: RunStore.queryRuns + shared HTTP auth module.** Foundation for the v0.12.0 dashboard — no user-facing behavior changes yet, but two pieces are now ready for the dashboard to build on:

### `RunStore.queryRuns({ filter })`

Richer run-query API with filter composition, offset pagination, and a total-count return. Supersedes `listRuns` for the dashboard's `/runs` page (and any caller that needs paged output without a second COUNT query):

```ts
const { rows, total } = store.queryRuns({
  agentName: 'hello',
  statuses: ['completed', 'failed'],     // OR within statuses
  triggeredBy: 'schedule',
  q: 'abc',                              // prefix on id OR substring on agentName (case-insensitive)
  limit: 50,
  offset: 0,
});
```

- All filter fields compose with `AND`; `statuses[]` OR's within itself
- `q` escapes SQL `LIKE` metacharacters so `50%` matches `"50%-win"` literally instead of every row
- `limit` is clamped to `MAX_RUNS_LIMIT = 500`; `DEFAULT_RUNS_LIMIT = 50`
- Two new indexes (`idx_runs_triggeredBy`, `idx_runs_startedAt` — DESC for the newest-first default) keep filter + order costs cheap
- `distinctValues(column)` helper enumerates seen agents / statuses / triggeredBy values for dropdown population; the column name is allowlist-checked so there's no SQL-injection surface from the string

Existing `listRuns` is untouched — MCP server, CLI `status`/`logs`/`cancel` keep working. Migration to `queryRuns` is opt-in per caller.

### Shared HTTP loopback auth (`@some-useful-agents/core/http-auth`)

The `checkAuthorization`, `checkHost`, `checkOrigin`, and `buildLoopbackAllowlist` helpers that lived in `packages/mcp-server/src/auth.ts` are now in core. Same implementations, same tests (via the existing mcp-server suite). The mcp-server's `auth.ts` is now a thin re-export so existing internal imports keep working unchanged. New `checkCookieToken` sibling for cookie-based auth (the dashboard's case).

Why: the dashboard needs the same three checks. Having it import from `@some-useful-agents/mcp-server` would couple a human-facing HTML surface to a programmatic-API package for a concern that belongs at the shared layer.
