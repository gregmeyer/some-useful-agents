---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Apple Notes: add a note-update tool to edit an existing note.

The Apple integration now exposes `apple.apple.note-update` (a sixth generated
verb): find a note by its current title and replace its body, optionally
retitling it. Backed by a new `cmdNoteUpdate` in the embedded Swift runner
(AppleScript; matches by name, signals not-found cleanly). Notes have no stable
id, so editing targets the title. Pairs with local edit-a-note / list-notes
agents (read the body, merge, update) for inbox-driven note editing.
