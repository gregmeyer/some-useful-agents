---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox thread usability (control-plane Phase 2): summary, reopen, fork, retarget.

A thread is now a stable working surface, not just a transcript:
- A derived **thread summary** block (goal / status / latest result / next step),
  computed from the thread's responses — no LLM call.
- **Summarize** pins that summary into the transcript as a system note.
- **Reopen** flips a resolved/dismissed thread back to open.
- **Fork to agent** opens a new thread targeting a chosen agent, carrying the
  summary + `forkedFrom` provenance (original thread is untouched).
- **Retarget** points the current thread at a different agent in place.

Fork/retarget targets are installed non-system agents. New
`InboxStore.updateMessage` patches a thread's agent link / context.
