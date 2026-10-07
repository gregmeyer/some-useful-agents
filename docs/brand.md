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

## Your brands

![Settings → Appearance: Update my brand and Your brands](images/appearance.png)

Keep more than one look and switch between them. At the top of **Settings → Appearance → Brand**, **Your brands** lists the ones you've saved, each with a strip of its colours:
- **Save as a brand** keeps the look in use under a name (saving with a name you've used replaces that brand).
- **Use this** makes a saved brand the look everywhere. The previous look stays one **Undo last change** away.
- **Delete** removes a saved brand; the look in use doesn't change.
- **In use** marks the brand whose colours, fonts, radius and accents match the look in use.

Saved brands are theme files in `.sua/brands/<name>.json`, checked like the active theme (one that doesn't validate is skipped).
## Update my brand (sua makes one)

At the top of **Settings → Appearance → Brand**, give sua your website (`https://yourcompany.com`) or a few words (`calm navy and coral, rounded`) and choose **Make my brand**. The `brand-maker` agent proposes colours for both modes, a font stack, corner radius and tile accents, and says where the look came from. A website is fetched and read; if its styles can't be read, the note says so.

- **Preview first:** the proposal is drawn as a small light and dark page in its own colours. Nothing changes until you choose **Use this brand**; **Discard** drops it, and **Try again** asks again.
- **Checked:** the proposal must pass the same checks as a hand-made theme (a font family that doesn't is dropped, not the whole brand). sua also measures contrast and lists anything hard to read: text on the page and on cards needs 4.5:1, muted text and the accent need 3:1.
- **Undo:** using it is an ordinary save, so **Undo last change** brings the previous look back.

The proposal waits in `.sua/brand-proposal.json`, one at a time.

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
- One look in use per dashboard at a time (switch between saved brands); a theme per board may follow.

## Related
- [Boards](boards.md) — the canvases the theme styles
- [Dashboard](dashboard.md) — Settings → Appearance
