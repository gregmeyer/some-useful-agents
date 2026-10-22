---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

"Needs you" means sua asked you something, and each row says what.

A thread used to wait on you whenever sua had replied, even when the reply only reported back, so "13 need your reply" opened a list that didn't say why. Now a thread waits on you only for a card to approve, buttons to pick from, a question sua asked, a note asking you to reply, or a failing agent (core `threadAsk`). A report settles as answered: still in Open and Chats, but off Today and out of the count. Existing threads are re-settled on restart.

Each waiting row says what it needs ("Choose: Try again · Move on", "Pick one: Rule it out · Keep it", the question itself) instead of the start of sua's message, and a thread waiting on one card gets that card's button and Not now on the row. The top bar's pill now reads "N need you" and counts what Today lists, so the two agree. Home's header controls are one row of matching buttons, with Autonomy as a menu that says what each setting does.
