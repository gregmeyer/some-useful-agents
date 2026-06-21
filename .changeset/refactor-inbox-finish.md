---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Refactor: finish the inbox route-file split (drop shims, repoint tests, shape seams).

Final slice of the inbox.ts refactor. Drops the temporary re-export shims and repoints the
9 sibling test files to import directly from the new modules (inbox-shared / inbox-catalog /
inbox-plan / inbox-widgets / inbox-engine), so inbox.ts now exports only `inboxRouter`.

Also shapes the seams for the planned "inbox span of control" work: a module-map header on
inbox.ts (route layer only — compose the siblings, don't regrow the god file), labelled route
bands (read · lifecycle · conversation+triage · metadata · actions · learnings), and a
doc-comment marking inbox-widgets.ts as the single in-thread output-widget boundary.

No behavior change. inbox.ts: 3217 (pre-refactor) -> 938. Full suite unchanged at 2018 pass /
3 skip.
