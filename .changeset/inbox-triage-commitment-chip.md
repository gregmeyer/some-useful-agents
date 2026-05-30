---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(dashboard): triage commitment chip + Cmd/Ctrl+Enter to send

**Triage no longer promises prose-only work.** The `inbox-triage` prompt now
forbids commitments like "I'll draft that for you in a few minutes" — every
promise must either propose an `<actions>` entry that does the work, or
honestly route the operator to the right tool when no agent can. When triage
DOES propose an action, it also emits a short `commitmentSummary` string
(e.g. "searching catalog for trivia agents") that the modal renders as a
pulsing pill next to the status badge. The chip stays alive while any of
the proposed actions are still in proposed/running state and clears once
they all terminate. Plan-envelope schema, route parsing, and SSE
`triage:complete` payload all carry the new field; existing replies without
a `commitmentSummary` render exactly as before.

**Cmd+Enter (Mac) / Ctrl+Enter (other) sends the reply.** A keydown delegate
on the modal catches the shortcut inside any `textarea[name="body"]` and
calls `form.requestSubmit()` on its enclosing `data-inbox-modal-form`. The
Post reply button gains a `title="Cmd/Ctrl + Enter"` tooltip for
discoverability. Plain Enter still inserts a newline.

First layer of the triage follow-through plan
(`~/.claude/plans/triage-follow-through.md`). Layers 2 (auto-approve trusted
chain) and 3 (sub-agent completion re-invokes triage) close the rest of
the "did you finish?" loop and ship as separate PRs.
