---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Two follow-ups to the tile-removal confirm modal:

- **Stay in edit mode after removing a tile.** The `pagehide` handler cleared edit mode on every navigation, including the delete redirect — so removing a tile bounced you out of edit mode. It now skips the clear when the navigation is a deliberate in-app action (confirmed delete / form submit), so you stay in edit mode and can keep arranging.
- **Pulse tiles get the same confirm modal.** The Pulse "hide from Pulse" × now shows the in-app modal too (previously it submitted with no confirmation). Confirm button label + title are per-form ("Hide" / "Hide tile?" on Pulse, "Remove" / "Remove tile?" on dashboards).

Also fixes a double-escaping bug in the confirm message — the tile title was manually `&quot;`-escaped and then re-escaped by the `html` tag, surfacing literal `&quot;` in the dialog. The manual escape is removed; the tag handles it.
