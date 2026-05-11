---
"@some-useful-agents/dashboard": patch
---

Edit mode on Pulse + dashboards now persists across page reloads.

Edit Layout was a JS-only toggle that reset to off on every full page reload. Since most edit actions (configure tile, change palette, hide signal, drag-and-drop save, container delete) trigger a form POST + redirect, every tweak kicked the user out of edit mode and they had to click Edit Layout again before the next change.

Persisted now in localStorage under `${storageKey}-edit-mode` (matched the existing `-palettes` / `-sizes` / `-collapsed` keys). Per-dashboard isolation is automatic via the runtime key suffix already used for the other keys.
