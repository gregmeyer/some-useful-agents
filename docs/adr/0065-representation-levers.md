# ADR-0065: Representation levers, not more boxes

- Status: accepted
- Date: 2026-11-02
- Deciders: Greg Meyer
- Builds on: ADR-0047 (A2UI views: the model's output is never drawn unchecked), ADR-0056 (layouts as documents), ADR-0064 (a page composed from what was written)

## Context

Once a page is composed around what was written (ADR-0064), it still read as boxes of equal weight: the rubric was a three-column grid, the ladder a diagram inside a list of sections at a third of the column width, and the number that decided the question ("4.4% at 12 months beats 4.35% at 60") a cell in a table. Next to a Claude artifact, which chooses a representation for each idea (a big number, a comparison, a figure that leads), the page felt like a template with slots.

Two ways to close that gap were weighed. Letting the model write HTML or SVG for a figure would give it the whole surface, but a model's drawing was poor last time ("a box with two circles"), it breaks the brief, templates and undo, and it crosses the line ADR-0047 draws. The other is to give the model more to choose from in the catalog: representation parts and a way to say which part leads. The user chose the second: every pixel stays code-drawn.

## Decision

1. **Four representation components**, all code-drawn, in the catalog, the client and the brief:
   - **Figure**: one written part (`/notebook/section/<key>`) on its own, `size: hero` drawn large (a ladder with tall bars, a split as a wide band).
   - **Lead**: the one number that matters, set in display type, from a `stat` the notebook works out.
   - **Bars**: options as bars by one numeric field, sorted by the field's better way, the best marked, ruled-out options left out.
   - **Compare**: two or three options side by side, their facts ruled line by line.
2. **One hero per page.** A Panel takes `hero: true`: its title in display type, full width, a lede or a feature. `pageRhythm` flags a composed page with no hero, two heroes, a hero inside a row, or a hero as an aside or band, and the page agent gets one more try.
3. **A `rubric` variant** on `AnswerSections` and `Figure` draws an If / Then / Why table as ruled decision rows.
4. **Numbers come from code.** `/notebook/numbers/<field>/{best, high, low, count}` are worked out from the options in the running (a range counts as its midpoint; lower is better for a price or when the field says so). The page binds to them; it never types a value in.
5. **Three page shapes** in the guide, DESIGN.md and the agent's prompt: hero + rail, story + rail, a band opener. Row rules from before still hold.

## Consequences

- The page agent has real choices without writing markup: which part leads, whether a number or a drawing carries the point, how the options are weighed.
- Shortlists, briefings and boards can use the same parts; nothing in them is notebook-only except the `/notebook/...` paths they bind.
- A model's SVG or HTML stays out of pages. If a figure the catalog can't draw is ever needed, it needs its own ADR (a sandboxed figure), not a widening of SanitizedHtml.
- The 28px display size now has four uses on notebook pages (a cover's name, pull quotes, a hero's title, a Lead's value); DESIGN.md says so.
