# Brand theme

One theme styles the whole dashboard: every page, every board, and every tile drawn inside a board, in every browser. Set it in **Settings → Appearance → Brand**.

## What you can set

- **Preset**: where the theme starts. *Default* is sua's own look; *Warm*, *Minimal*, *Neon* and *Editorial Paper* are alternatives. (These used to be per-browser "widget themes"; they're now a starting point everyone shares.)
- **Colours for dark and light mode**: accent, page, surface, raised surface, border, text, muted text, good, warning and error. Leave a field empty to keep the preset's value; the placeholder shows what that is. The light/dark switch in the top bar still chooses the mode.
- **Fonts**: the text font and the code font, as family names separated by commas. Use fonts the viewer's computer has (the dashboard loads no web fonts besides its code font).
- **Corner radius**: small, medium and large, in pixels.
- **Tile accents**: the six colours a tile's accent edge can be (teal, blue, green, orange, red, purple). The accent tile palettes (accent-teal, accent-red, accent-green) tint from these too.

Colours can be `#rrggbb` (or `#rgb`, `#rrggbbaa`), `rgb(…)`, `rgba(…)`, `hsl(…)`, `hsla(…)` or `transparent`. Anything else is refused, so a theme can't break the page's styles.

**Save brand** applies it everywhere at once. **Undo last change** puts the previous theme back; **Reset to sua's default** clears it. A save from a page that's out of date (someone else changed the theme meanwhile) is refused rather than overwriting their change.

## How it works

The theme is stored at `.sua/theme.json` in your data directory and served as `/assets/theme.css`, a set of CSS custom properties (`--color-primary`, `--font-sans`, `--radius-md`, `--accent-teal`, …) on top of the design tokens. Every stylesheet and every A2UI component reads those tokens, and they reach inside each board tile, so nothing needs to know about the theme itself.

```json
{
  "version": 1,
  "name": "Acme",
  "preset": "warm",
  "dark": { "primary": "#ec4899" },
  "light": { "primary": "#be185d" },
  "fonts": { "sans": "\"Inter\", system-ui, sans-serif" },
  "radius": { "md": 8 },
  "accents": { "teal": "#14b8a6" }
}
```

You can edit the file directly; the next page load uses it. A file that doesn't validate is ignored (the default theme applies) rather than breaking the dashboard. The file also covers colours the form doesn't show (`text-subtle`, `primary-hover`, `primary-soft`, `ok-soft`, `warn-soft`, `err-soft`, `info`, `info-soft`).

## Agents and the brand

Agents style through names, never colours: tones (`neutral`, `ok`, `warn`, `err`) on Metric and Badge, tile palettes and accents by name, and no colours or inline styles in agent-written HTML. `board-read` ends with this guide, so an agent arranging a board sees it, and whatever it builds follows the theme.

## Limits

- Older widgets that set their own colours in their HTML (some `ai-template` widgets) keep those colours.
- One theme per dashboard for now; a theme per board may follow.

## Related
- [Boards](boards.md) — the canvases the theme styles
- [Dashboard](dashboard.md) — Settings → Appearance
