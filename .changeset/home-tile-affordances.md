---
"@some-useful-agents/dashboard": minor
---

Home-page tiles get palette + collapse parity with pulse + dashboard tiles.

The root home page (`/`) renders system widgets via a separate code path (`renderHomeWidget`) that stripped the tile chrome — no palette button, no collapse chevron — so users in edit mode couldn't change tile appearance the way they can on `/pulse` or `/dashboards/<id>`. Now both are rendered on home tiles too. The configure (⚙) and × delete buttons remain omitted: system widgets are hardcoded renderers (Scheduled, Recent Activity, etc.), not template-driven — the template picker / slot mapping in the configure modal don't apply, and these tiles are persistent by design.

The collapse click handler moved from `pulse-layout.js.ts` (which used a hardcoded `sua-pulse-collapsed` storage key) into `widget-layout.js.ts` so each surface scopes its persistence correctly. The duplicate handler in `dashboards-layout.js.ts` was also removed to avoid double-toggle. Net result: pulse, home, and per-dashboard collapse state all persist under their own keys.
