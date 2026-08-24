---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

The dashboard's landing page now orients a newcomer.

For any real install, `/` rendered only the inbox feed — no explanation of what
sua is, and no route to the starter agents or the tutorial anywhere in the body.
On a quiet day the whole page was one dim line. The zero-agent state does orient
the reader, but it cannot render on a normal install because `sua init` installs
around forty agents, so in practice nobody saw it: the shortest real path to
`/start` was `/` → Help → scroll → card.

`/` now opens with a dismissible line saying where agents run and what the page
is for, a link to the fuller "What is sua?" explanation on `/help`, and buttons
for **Start here** and the **Tutorial**. It disappears for good once dismissed.

Also in this pass:

- The starter page called itself four different things — "Quick start" in its
  header, "Start here" in the tab, the title and the pack. It is "Start here".
- `/connect-model` no longer highlights Settings in the nav; it is a first-run
  setup screen that is not in the nav, so nothing lights up.
- `/start` now distinguishes "the starter pack is not installed" from "the three
  starter agents are missing", and leads with the dashboard route to fixing
  either rather than a CLI command.
- `pageIntro` accepts optional next-step buttons, and only opens a new tab for
  genuinely off-site links.
