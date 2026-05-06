---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Browse and install widget packs from the dashboard (widget-packs PR 3/5).

New routes:

- **`GET /packs`** — grid of all registered packs, split into Installed
  and Available sections. Cards show name, description, version, source,
  dashboard/agent counts.
- **`GET /packs/:id`** — pack detail with manifest summary (dashboards
  by name + section count, agent ids) and an Install or Uninstall button.
- **`POST /packs/:id/install`** / **`POST /packs/:id/uninstall`** — call
  the installer from PR 2; redirect back to the detail page with a flash
  banner reporting what changed.
- **"Packs" entry in the top nav**, between Pulse and Settings.

Plus a "clear-the-slate" pair on Pulse:

- **`POST /pulse/hide-all`** — bulk-flip `pulseVisible=false` on every
  agent that has a signal block. Use case: "I want to install a pack
  and only see those tiles". Reversible.
- **`POST /pulse/show-all`** — restores everything that was hidden.
- **"Hide all" button** appears on the Pulse header when at least one
  signal is visible; flips to "Show all" when nothing is visible but
  hidden tiles exist.

5 new route tests; full suite 1022/1022 green. Live smoke confirms
install/uninstall round-trip + bulk hide/show.
