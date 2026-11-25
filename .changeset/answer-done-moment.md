---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

An answer says Done, once, with the way to it.

- **Done message:** when the last of sua's steps finishes, the conversation says "Done: 5 options, 6 sources, 5 quotes found on their pages. One step is yours: Pick one. Open the answer →", once a question.
- **The conversation's card:**
  - it shows the answer's kind and a short list of its steps (✓ done, running, ! stopped short, ● yours, ○ to do), each with its own note;
  - it opens with **Open the answer →**;
  - two or more "Step i of N is done" messages in a row fold behind **Show each step**.
- **Pill:** for half an hour, the top bar's pill reads "✓ Done: <title>" and opens the answer.
- **"Under way" message:** it now says sua will say here when it's done.
