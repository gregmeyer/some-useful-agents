---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

`/agents` search now ranks by relevance instead of substring matching.

Searching "watch a website for changes" used to return nothing, because the box
only matched substrings of id, name and description. Inbox triage has always
ranked agents properly — scoring `tags`, `entryConditions` and `sampleQuestions`
alongside id/name — so the search box now uses that same ranker, lifted into
`@some-useful-agents/core` as `agent-relevance.ts`.

Relevance widens and reorders; it never removes. Everything the substring match
found still matches. Best-match ordering is implicit while searching and any
explicit sort overrides it.

Also in this change:

- A search that matches nothing no longer hides the search box, so the query
  stays editable. It says which tab the matches are in instead ("2 in Examples")
  and points at the `sua ›` bar.
- The query echoes back as typed rather than lowercased.
- `Sort: name` sorts by name; it sorted by id.
- Legacy v1 agents now respect the search box instead of always listing.
