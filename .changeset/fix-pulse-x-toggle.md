---
"@some-useful-agents/dashboard": patch
---

Fix the × button on pulse tiles — it was toggling the legacy `signal.hidden` field, but the pulse-visibility filter has preferred `pulseVisible` since v0.19. Once any agent had `pulseVisible` set (which the Config-tab visibility toggle does on first click), clicking × posted successfully but the tile stayed visible.

`POST /agents/:id/signal/toggle` now flips `pulseVisible` instead. The hide-all / show-all handlers + the Config-tab toggles all use the same field, so behaviour is consistent across surfaces.
