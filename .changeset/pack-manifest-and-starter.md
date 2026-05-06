---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Pack manifest format + first built-in Starter pack (widget-packs PR 2/5).

Builds on PR 1's stores. New modules in `packages/core`:

- **`pack-schema.ts`** — Zod schema for the pack manifest YAML format.
  Validates pack id, semver version, dashboard structure, and the
  `yaml` / `yamlPath` mutual exclusion on agent refs.
- **`pack-loader.ts`** — discovers `packages/core/packs/*.yaml` on
  daemon start, validates each, resolves `yamlPath` agent refs against
  the manifest's directory, and upserts into `PacksStore` as
  `source = 'builtin'`. Idempotent: reload preserves `installed_at`,
  so a manifest version bump doesn't toggle install state. Failures on
  individual files are skipped (returned in `result.skipped`) so one
  broken pack doesn't gate the rest.
- **`pack-installer.ts`** — `installPack(packId, ctx)` and
  `uninstallPack(packId, ctx)` orchestrate across PacksStore +
  DashboardsStore + AgentStore (the latter optional). Reference-only
  ownership: install upserts missing agents from embedded YAML;
  uninstall removes only the dashboards.
- **`packages/core/packs/starter.yaml`** — first built-in pack. Bundles
  the three dogfood agents from #199 (vimeo-staff-picks +
  weather-forecast + cat-video-finder) into two dashboards (Media +
  Weather). Auto-registers on daemon start; visible in PR 3's UI.

Daemon startup (`packages/dashboard/src/index.ts`) now calls
`loadBuiltinPacks(packsStore, defaultBuiltinPacksDir())` immediately
after PacksStore init. Best-effort — failures don't block the
dashboard from coming up.

Added `packs/` to `packages/core/package.json`'s `files` array so the
bundled manifest ships with the npm package.

22 new unit tests; full suite 1017/1017 green.
