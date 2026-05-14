---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Harden the dashboard CSS bundler against the foot-gun where bare `tsc --build` skips `scripts/copy-assets.mjs` and leaves `dist/assets/` empty, causing the dashboard to serve five `/* missing */` stubs and a styleless page.

Two changes in `routes/assets.ts`:

- `loadDashboardCss()` now falls back to `<pkg>/src/assets/<name>.css` when `<pkg>/dist/assets/<name>.css` is absent. Dev workflows that build with bare `tsc` still get a fully-styled dashboard.
- If *both* locations are missing for every source file, the loader throws on startup with a message naming the most common cause ("re-run `npm run build`") rather than silently serving stubs.

Plus a new vitest assertion (`serves a real /assets/dashboard.css`) that fetches the route and rejects any `/* missing */` content. CI now catches the regression at test time instead of at the user's hard-refresh.
