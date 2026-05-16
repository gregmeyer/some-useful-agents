---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

`sanitizeHtml` now preserves `<style>` blocks (with their bodies scrubbed for `javascript:` / `expression()` / `behavior:` / external `@import`) instead of stripping them entirely. ai-template widgets that rely on CSS-grid or flex layout — e.g. hero stat cards, dashboard hero sections — render with their intended layout instead of falling back to vertical block stacking.

Threat model unchanged in practice: the dashboard's CSP already permits `'unsafe-inline'` styles, and the new `sanitizeStyleBlock` helper applies the same scrubbing the existing inline-`style="…"` sanitizer uses (kills `javascript:`/`expression()`) plus stylesheet-specific defenses (`behavior:`, external `@import`). `<script>` and other dangerous block constructs still get stripped.
