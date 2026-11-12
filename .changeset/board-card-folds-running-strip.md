---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A board's goal area folds to one row, says what's running, and never prints "[object Object]".

- The goal, sua's suggestions and the layout tools (Arrange, Suggest a layout, Undo, How it looks) are one part of the page that folds to a row; it opens by itself when something needs you and otherwise stays as you left it.
- A "Running now" strip at the top of a board (and of Pulse's edition) says what is running, with the time: sua reviewing, drafting or redrawing, and any of the board's agents mid-run. It keeps itself current and redraws the page when sua's work ends.
- A board page that bound a headline to a whole list item printed "[object Object]". A Callout now says an item by its title, and a page that binds words to a list, a list item or an object is refused so sua fixes it.
