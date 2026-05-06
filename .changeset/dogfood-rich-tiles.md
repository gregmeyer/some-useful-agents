---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Switch the two remaining dogfood agents to `signal.template: widget`
so their dashboard tiles render the full output widget instead of a
compact text-headline.

`weather-forecast` and `vimeo-staff-picks` previously used
`text-headline`, which surfaced just temperature/condition or
`fetched_at` on tiles — none of the view-switch / field-toggle /
replay / iframe machinery the agents were specifically built to
showcase. `cat-video-finder` was already on `template: widget` and
served as the proof. With this change all three demo tiles now
render their full widgets, matching their behaviour on the agent
detail page.

Each YAML gained a comment explaining the trade-off: `text-headline`
is the compact alternative for high-density Pulse layouts.
