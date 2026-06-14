---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

De-monolith the inbox triage prompt: shared kernel + per-source playbooks.

The triage agent's prompt had grown to one ~550-line block mixing shared
mechanics (voice, action-proposal rules, the `<plan>` output schema) with
source-specific "what to recommend" guidance, so unrelated concerns shared one
prompt and interfered. The prompt is now composed at run time from fragments on
disk: a single `kernel.md` (the shared mechanics, one source of truth coupled to
the route's `<plan>` parser) plus the one `playbooks/<source>.md` that matches
the thread's source (run-failure / permission-request / cadence / manual),
selected deterministically from the known `source` field — no classifier LLM and
still one model call per turn. A thread now only sees its own source's guidance.
Behavior is preserved; this makes triage far easier to maintain and extend (add
or refine a source = edit one small file).
