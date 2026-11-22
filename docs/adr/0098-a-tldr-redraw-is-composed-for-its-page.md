# 0098. A TL;DR redraw is always composed, shaped for its page

- Status: accepted
- Date: 2026-11-22
- Supersedes: in [ADR-0096](0096-tldr-card-composed-as-a2ui.md), "the seven fixed layouts stay, as the default and the fallback", for a redraw by sua

## Context

ADR-0096 let a redraw carry an A2UI `view`, but left it optional. The `notebook-tldr` agent was told to compose "when the fixed layouts can't do what they asked", and a view that failed fell back to a fixed layout. In practice most redraws still came back as a fixed layout (a landscape "split" with the words beside the points). The look stayed boxed in, which is what the view was meant to fix.

A redraw also knew nothing about where the picture sits. A notebook's page (its layout preset) has a clear idea of what should lead: a shortlist's bars, a person's portrait, a subject briefing's sources' photos, an answer's headline. The **In short** card that shows the picture is a full-width panel. But a redraw only took its size from the words of the ask.

## Decision

- **A redraw by sua always composes.** An answer with no `view`, or one that can't be drawn, is asked for once more with the reason. Then the redraw fails: the picture stays as it was, and the Redraw page says why and offers **Try again**. There is no fixed-layout fallback.
- **The agent isn't offered the fixed layouts.** Its `OPTIONS` are the sizes, the tones and the view guide (`tldrSizesTonesGuide` + `tldrViewGuide`). Anything it says about `layout`, `parts`, `picture` or `bars` is dropped.
- **Each page has a preferred picture.** `tldrPreference(preset, card)` in core gives a size and a lead:
  - the size is always landscape (1200×627);
  - the lead is bars for a shortlist or a watch, a photo for a meeting or company briefing, a photo grid for a subject briefing, and the headline for an answer, a runbook or a plan;
  - a page with no preset goes by what the card has.

  It steps down to what the card can draw: a grid needs two photos, a cover needs a picture, and bars need bars.
- **The preference is the default.** It goes to the agent as `PREFER` and is used unless the ask names a size or a lead. An answer with no size takes the preferred size. The Redraw page shows it ("This page prefers: …"), and **Fit this page** asks for it.
- **Words with a stray number.** A headline or takeaway with a number the card doesn't have is dropped and the card kept. A number in the view's own words sends the answer back.
- **Older specs still draw.** The seven fixed layouts stay in the renderer and in the MCP `notebook-tldr` tool, which edits a spec directly. That tool now drops a composed view when it is given a `layout` or `parts`.

## Consequences

- Redrawn cards look like their page and vary more. A "split" is no longer the usual answer.
- A model that won't compose leaves the picture unchanged instead of drawing a dull fallback. The page says so, and **Try again** is one press.
- The preference table is one place (`TLDR_PREFERENCE_BY_PRESET`) to change when a preset is added.
