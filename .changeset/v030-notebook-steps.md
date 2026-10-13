---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notebook steps: find, source, check, decide, one at a time.

A notebook can lay out its work as steps, and works through them one at a time, pausing after each. sua drafts the steps from your sentence or the conversation, and adds them to a notebook that started without any. See [docs/notebooks.md](https://github.com/gregmeyer/some-useful-agents/blob/main/docs/notebooks.md).

- **A Next step button** in the header. Steps set up partway through start where the work is.
- **A source step** names the facts it looks up and counts them one by one. **A check step** (the notebook-checker agent) ticks a check only when a quote shows it.
- **A narrow step** cuts the list without closing the notebook. When a step can't do every option, it can check or source just the top ones. When it can't go further, it stops gracefully, with Move on.
- Done-whens that repeat the notebook's own work tick themselves. Stages moved by hand stop showing on notebooks with steps.
- **Decide…** picks from the options still in the running (with pictures), can tick sua's picks, and marks them "✓ chosen". A decided notebook shows its final set on its page and in its CSV, and still files what its agents find.
