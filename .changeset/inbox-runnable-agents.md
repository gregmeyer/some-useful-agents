---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox: run agents in a thread and see their output rendered inline.

- New per-agent `permissions.inboxRunnable` opt-in. Triage can propose running
  any installed local/community agent that declares it, approval-gated.
- Completed inbox action results now render the agent's output widget **inline**
  in the thread (with a "Raw result" fallback), instead of just a text preview.
  Inline widget images are gated by the agent's CSP image-host allowlist, with a
  one-click "Allow host" affordance when a host is blocked.
- Agents auto-committed from an inbox build are now stamped `inboxRunnable: true`,
  so "build me an agent, then run it" works inline in a single thread without an
  extra install step.

(Consolidation: supersedes the thread-scoped inline-run heuristic shipped in #464
with the first-class `inboxRunnable` capability model.)
