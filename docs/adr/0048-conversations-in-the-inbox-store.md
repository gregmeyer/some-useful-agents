# ADR-0048: Conversations live in the inbox store

- Status: accepted
- Date: 2026-10-02
- Deciders: Greg Meyer

## Context

sua had two conversation models with no link between them. Inbox threads (`inbox_messages` +
`inbox_responses`) carry triage, action cards and inline widgets. Agent chat sessions
(`sessions` + `session_turns`, ADR-0039) carry turns with an agent. The conversations plan
(`~/.claude/plans/conversations-everywhere.md`) puts one side panel on every page and lists every
conversation in one inbox, which needs one model. This supersedes only the storage part of
ADR-0039; continuity by transcript is unchanged.

## Decision

- A conversation with an agent is an `inbox_messages` row with source `conversation`, the agent
  in `agent_id`, priority `low`, status `open` and the placeholder body `(empty)` (as on a manual
  thread). Each turn is an `inbox_responses` row: role `user`, or the new role `agent`, with
  `{runId, failed}` in `meta_json`. Turn order is `created_at`, then rowid; `seq` is computed.
- `SessionStore` keeps its API, so the CLI, MCP `run-agent`, the Chat tab, the socket and Temporal
  don't change. It only sees `conversation` threads, so an inbox thread id is never a session.
- The inbox list, its search and agent filter, and auto-triage skip `conversation` threads unless
  a caller asks for that source. They appear in the inbox with the split view (phase 3).
- Migration runs when a `SessionStore` opens a database that still has `sessions`: inside
  `BEGIN IMMEDIATE`, copy every session not already present (ids kept, ISO times to epoch ms),
  then rename the old tables to `*_legacy`. If an older build recreated them after a migration,
  the next run copies only the new sessions, merges the rows into `*_legacy` and drops the
  recreated tables.

## Consequences

- Phase 1b can render both kinds of thread with one component, and phase 3 can list them
  together.
- Deleting an agent deletes its `conversation` threads, not its other inbox threads.
- The `*_legacy` tables are a backup and are not read. A later release can drop them.
- A turn appended by an older build after the migration, to a session that was already copied,
  is not carried over.
