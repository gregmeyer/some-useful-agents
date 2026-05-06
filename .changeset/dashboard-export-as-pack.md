---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

"Save as pack" — export a dashboard as a portable pack manifest YAML.

Adds a download path so users can take a dashboard they've curated and
turn it into a shareable pack file. Bundles the dashboard's layout
plus the full YAML of every agent it references into one manifest.

- **`dashboardToPackManifest()`** in core. Round-trips through
  `packManifestSchema` — the file the browser downloads is parseable
  by the existing pack loader and installable via `installPack`.
- **`GET /dashboards/:id/export`** returns a YAML attachment with
  `Content-Disposition: attachment; filename="<pack-id>.pack.yaml"`.
  Missing agents (referenced in sections but not in the agent store)
  are dropped from the export and surfaced via an
  `X-Pack-Missing-Agents` response header.
- **"Save as pack"** button on every dashboard view page, alongside
  Edit layout / Edit sections.

For now there's no user-pack directory — the downloaded file is
ready to share or commit, but installing it locally still means
dropping it in `packages/core/packs/` (a follow-up will add a
user-pack directory under `~/.sua/packs/` so the loader picks them
up automatically).

6 new unit tests cover round-trip-through-schema, missing-agent
handling, namespace stripping, and id/name/version overrides.
