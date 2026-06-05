---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": minor
---

Inbox: agents built from a thread are now real, runnable, and honestly reported.

When triage built a new agent (e.g. "make me a random XKCD viewer"), the build
ran but nothing committed it — `agent-builder` only designs and validates YAML,
and the inbox action path skipped the commit the dashboard wizard does. The
agent existed only as text in the run output, so `/agents/<id>` 404'd and triage
would still claim it was "drafted" and link a dead URL.

Three fixes:
- **Auto-commit built agents (as drafts).** When an `agent-builder` action
  completes, the validated YAML is parsed and committed to the catalog as a
  draft (visible + runnable on demand, not live/scheduled until reviewed). A real
  `/agents/<id>` link is posted once it lands. An existing non-draft agent of the
  same id is never overwritten.
- **No more fabricated links.** Triage `/agents/<id>` links are dropped unless the
  agent actually exists in the store, and the triage prompt no longer claims an
  agent exists before the system confirms the commit.
- **Run what you just built, inline.** Agents built earlier in a thread become
  proposable, so triage can run them and stream output inline — gated on operator
  approval (they are not auto-approved).
