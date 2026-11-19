---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Ask sua for a different picture for a notebook, and it finds one, shows it, and uses it.

Asking a notebook's conversation for "a different photo" used to go to the correction agent, which can't change a picture and asked you for a link. sua now finds a picture itself (openly licensed, with its page and credit), shows it, and offers a **Use this picture** card (`notebook-photo`). Approving it keeps a copy in the notebook and puts it at the top of the page, credited; ask to go back to the sources' photos any time. For the photo of who a briefing is about, sua finds one that is clearly them and offers the correction, instead of asking you for a link.
