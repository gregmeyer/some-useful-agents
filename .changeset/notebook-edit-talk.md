---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/dashboard": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
---

Edit a notebook by saying what to change, with a preview of its page before you save.

A notebook's Edit page has two tabs. Talk shows the notebook in a few lines; say what to change and sua changes the setup (and the page, when you asked about the page), listing what changed. Prompt is the whole notebook as a markdown document to edit. Either way the change is a proposal: the preview beside it draws the notebook's page as it would be, and Save changes or Discard decide. The setup form is folded under Prompt as "Edit field by field", and the other actions under More. The page agent takes what you asked and the page it changes. Messages after notebook actions ("Saved.") now show on the page.
