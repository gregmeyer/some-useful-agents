---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

inbox-triage: direct-voice prompt + stronger catalog-search trigger.

The triage `recommendation` is rendered verbatim in the conversation
thread, but the model sometimes emitted stage directions instead of
the actual message — e.g. "Reply with a clarifying question before
routing: ask whether they want…" or "shortlist request: ask what
platform or directory they want the existing trivia agent from"
instead of just asking the question or proposing the catalog search.

Adds a VOICE section near the top of the prompt with bad-vs-good
examples (first-person direct reply, no meta-narration about
routing/shortlisting) and two new OUTPUT FORMAT examples: a
clarifying question done right, and a catalog-search proposal for a
concrete topic.

Also strengthens the agent guide for `agent-catalog-search` (shipped
in #393) so the model proposes it DIRECTLY when the operator names a
topic ("trivia", "cocktail", "weather"), without first asking which
platform or directory — the installed catalog IS the directory.
