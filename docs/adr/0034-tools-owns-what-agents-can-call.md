# ADR-0034: Tools owns what agents can call; navigation is organised by direction and by kind

- Status: accepted
- Date: 2026-08-25
- Deciders: Greg Meyer

## Context

Five nouns meant some version of "a thing an agent can call", split across two
navigations:

| noun | lived in |
|---|---|
| Tools | Agents sub-nav → `/tools` |
| Nodes | Agents sub-nav → `/nodes` |
| Integrations | Settings tab |
| MCP | Settings tab |
| MCP Servers | Settings tab, immediately next to MCP |

Three things made this worse than a tidy-up job.

**One of the five was not a sibling.** `/settings/mcp` is sua exposed *as* a
tool — the outbound server Claude Desktop connects to so other apps can call
sua's agents. `/settings/mcp-servers` is the opposite direction: servers sua
imported tools *from*, so sua can call *them*. They sat adjacent, named "MCP"
and "MCP Servers", and so read as a pair. Their only real relationship was three
shared letters. Merging them would have been actively wrong.

**The cross-links did not merely show the split was felt — one of them lied.**
The Integrations page told users: *"No MCP servers connected. Add one at
Settings → MCP Servers first."* You cannot add a server there. That page says
*"Use Tools → Import to add one"*, and declines to host the add flow on purpose,
because discovery has to connect to the server and list its tools. So the path
was Integrations → MCP Servers → Tools, and the first hop was false.

**Nodes had no inbound links at all.** Nothing in the product linked to
`/nodes`; it was reachable only by clicking its own sub-nav tab. It is
hand-authored reference documentation about how agents are built — there is
nothing on it to create, edit, or delete — sitting in a nav slot beside managed
resources.

The surrounding trend mattered too. The seven PRs before this one (#636–#642)
added five nouns and removed none; the count of distinct concepts a newcomer
meets before running anything went from ~30 to 35. Each addition was locally
right. This ADR is the counterweight, and the first one to record a *rule*
rather than a rearrangement.

The top-level nav has already flip-flopped four times — #534 unified it, #535
collapsed `/pulse` and removed a duplicate "Home", #577 reversed part of #536,
#590 restored `/pulse` — with no ADR at any point. The Agents sub-nav was
designed once as five items in #359 and then grew by accretion: `scheduled`
(#365), `start` (#620), `behaviors` (#632), each bolted on alone, never
revisited as a set. Nothing recorded why anything sat where it sat, so each
change re-derived the structure from scratch.

## Decision

**Tools is the one home for everything an agent can call.** `/tools` gains two
tabs alongside its catalog:

- **Built-in** — ships with the runtime.
- **Imported** — came from an MCP server. (Was "User tools".)
- **Servers** — the MCP servers those imports came from; enable, disable,
  delete. Moved from `/settings/mcp-servers`.
- **Integrations** — saved credentials and endpoints an agent references by id.
  Moved from `/settings/integrations`.

**`/settings/mcp` is renamed "Claude Desktop"** and stays in Settings. It is not
part of the cluster; it is named for what it does now that its confusing
neighbour has moved out.

**Nodes becomes "Node reference" under Help**, at the same `/nodes` URL, with a
back link and an entry point from the Help page it never had.

**Three navigation rules**, which are the durable part of this decision:

1. **Direction decides the section.** What sua can call lives under Agents.
   What can call sua lives in Settings. This is what separates Tools → Servers
   from Settings → Claude Desktop, and it is the distinction the old naming
   destroyed.
2. **Reference documentation does not get a nav slot.** If a page has nothing
   to create, edit, or delete, it belongs under Help. A page nothing links to is
   strong evidence it is reference, not a destination.
3. **Manage a thing beside the thing it produces.** Servers produce tools;
   they belong on the Tools page. A resource one nav away from its output
   generates exactly the kind of cross-link that sent users in a circle here.

**Only navigable GET pages moved. The mutating POST endpoints keep their
`/settings/...` paths** — they are form targets, not URLs anyone reads, and
rewriting them would have churned a dozen redirect strings for no user-visible
gain. Old GET URLs 302 to the new location, preserving the query string, so
bookmarks, docs and the integration-add error round-trip all still work.

## Consequences

**Good.** Five sibling nouns spread across two navigations become one section
plus one honestly-named Settings tab. The Agents sub-nav goes from eight tabs to
seven, and Settings from nine to seven. The false cross-link is gone, and the
page that could not add a server no longer claims it can. Someone who imports an
MCP server now sees the server, its tools, and its saved connections without
leaving the page.

**Be honest about the count.** Counting nav-reachable labels (top nav + Agents
sub-nav + Settings tabs + Tools tabs), this change moves 24 → 23. It is *not*
the large drop the framing might suggest, because Servers and Integrations did
not disappear — they moved and were renamed. The real win is coherence, not
arithmetic: the five labels that all meant "a thing an agent can call" now sit
in one place with one parent noun, and the one that never belonged is named for
what it does. Anyone citing a concept count should state the enumeration they
used; earlier estimates in the design-pass notes used a looser one that also
counted in-page groupings, and the two numbers are not comparable.

**Cost.** `/tools` now costs two extra SQLite reads per request to populate the
Servers and Integrations tab counts. Both are direct scans already performed
elsewhere on other pages, and the counts are what make the strip honest, so we
accept it. The Integrations tab also nests a second tab strip (the integration
kinds) inside the Tools strip; two levels is the most we will accept, and a
third would be a signal that Integrations needs its own page after all.

**Trade-off accepted.** Integrations hold credentials — a Postgres DSN, a Slack
webhook — which is an argument for keeping them next to Secrets. We chose
callability over sensitivity: an integration is referenced by an agent at
run time the way a tool is, whereas a secret is injected into an environment.
If Integrations grows its own permission model, that reasoning should be
revisited.

**Not addressed.** The top-level nav itself is untouched — Inbox · Agents ·
Settings · Help, with the `sua` brand as the home link — and this ADR is not a
licence to reopen it. The Agents sub-nav still carries seven tabs, which is
more than #359's original five; `start`, `behaviors` and `scheduled` each have
a plausible claim to belong elsewhere, and none is settled here. Renaming
"node" itself was considered and rejected: it is the live vocabulary
(`/nodes`, the agent detail Nodes tab, `nodes[]` in every agent file), and a
half-rename would be the same accretion this ADR exists to counter.

## Alternatives considered

- **Merge `/settings/mcp` into the Servers tab.** Rejected. They are opposite
  directions of the same protocol; merging them would formalise the confusion
  the names created rather than resolve it.
- **Leave Integrations in Settings** (fold in only MCP Servers). Reasonable —
  credentials arguably belong beside Secrets — but it leaves an agent author
  bouncing between two navs to wire up a notify destination, and preserves the
  cross-link pattern that produced the false link.
- **Rename and relink only, moving nothing.** Lowest risk, and it would have
  fixed the lie. Rejected because it leaves five nouns standing, and the
  concept count is the thing that needed to come down.
- **Give Nodes a `/help/nodes` URL.** Rejected as churn: the page is unchanged,
  nothing links to the old URL, and a redirect costs more than it returns.
