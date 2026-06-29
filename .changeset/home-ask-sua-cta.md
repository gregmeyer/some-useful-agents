---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Home: inbox-first "Ask sua" CTA + a global top-bar "needs you" toast.

The unified home had three competing action clusters in the upper-right — the old
"Build from goal" / "Browse packs" header buttons, the Needs-you strip's "Open
inbox", and the board's own controls. Now:

- The header buttons are replaced by a single primary **Ask sua →** that opens a
  fresh inbox thread (`POST /inbox/new`). Build-from-goal still lives on /agents
  and the no-agents empty state.
- The "needs you" signal moves off the home body into a global **top-bar toast**
  ("N need your reply →") shown in the top-bar empty space on every page whenever
  inbox threads await a reply (count from `/inbox/needs-you-count`). This removes
  the redundant "Open inbox" callout and tightens the home's vertical — the page
  now leads straight into the board.
