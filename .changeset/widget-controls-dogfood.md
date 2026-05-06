---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Three new example agents that exercise the recently-shipped ai-template
widget capabilities end-to-end:

- **`vimeo-staff-picks`** — `ai-template` + `<iframe>` (player.vimeo.com,
  on the new sanitiser allowlist) + `{{#each}}` iteration + `replay`
  control. Renders the latest Vimeo Staff Picks as inline players.
- **`weather-forecast`** — `dashboard` widget + `view-switch`
  (today/week) + `field-toggle` (extras) + `replay` (different city).
  Live wttr.in data; stress-tests every dashboard widget control type.
- **`cat-video-finder`** — `ai-template` + `{{#if outputs.thumbnail}}` /
  `{{#unless outputs.url}}` + `replay` with input-tweak. Facade-pattern
  card around a YouTube search hit (clickable thumbnail, opens on
  YouTube).

Together these cover all 7 capabilities that previously had zero
in-repo examples: `replay`, `field-toggle`, `view-switch`, `{{#if}}`,
`{{#unless}}`, `{{#each}}`, and `<iframe>` from the host allowlist.
