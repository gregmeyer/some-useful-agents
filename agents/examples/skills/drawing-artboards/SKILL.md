---
name: drawing-artboards
description: How to draw an illustrated artboard (numbered panels, each a small scene with a caption) as one clean SVG, in a flat illustration style.
---

An artboard explains something in pictures: each panel is a small scene
someone understands before reading its caption. Draw it as one SVG.

## The canvas

- One `<svg>` with `width`, `height` and a matching `viewBox` (1600×1000 by
  default; follow a size you're given).
- A soft background, a title at the top (44–56px), an optional subtitle
  (24–28px), then the panels in a grid in reading order: 6 panels are
  3 across and 2 down, 4 are 2×2, 3 are 3×1. Leave 32–48px between panels
  and 56–72px of margin, so nothing touches an edge.
- Each panel is a rounded card (radius 20–28) with a light fill and a thin
  border. In it: a number badge in the top left (a filled circle, 40–48px,
  white bold number), the scene in the middle, the caption at the bottom.

## The scene in each panel

- Show the action, not a word for it. Draw the objects the step names and
  what is being done to them: a hand holding a knife over bread, a jar with
  its lid off, two slices side by side on a plate.
- Build objects from simple shapes: rects with rounded corners, circles,
  ellipses and a few paths. A recognizable silhouette and one or two
  telling details (a crust edge, a jar label, a knife's blade and handle)
  beat fine detail.
- Keep a consistent scale and light from panel to panel: the same plate,
  bread and tools look the same in every panel they appear in, so the
  panels read as one sequence.
- Ground each scene: a table edge, a plate or a shadow ellipse under it.
- Show change between panels (a spread appears on the bread, the slices
  close) so the sequence tells the story.

## Style

- Flat illustration: solid fills, a darker outline (2.5–4px) on the main
  objects, at most one soft shadow per object. No photographs, no
  gradients on everything, no clip art look.
- A palette of 5–7 colors that fit the subject, plus a near-black for text
  and outlines. Use the same color for the same thing everywhere.
- Hands are simple: a rounded mitten shape with a cuff, in one skin tone.

## Text

- Captions are short (at most 8 words), 22–28px, centered, never overflowing
  the card: break a long caption into two `<tspan>` lines.
- Fonts: a system stack (`font-family="Georgia, 'Times New Roman', serif"`
  for titles, `Helvetica, Arial, sans-serif` for captions). No web fonts.
- Text is dark on light, 4.5:1 contrast or better.

## Rules

- One self-contained `<svg>`: no `<script>`, no `<foreignObject>`, no event
  handlers, no outside links or images (they're taken out before drawing).
  Reuse shapes with `<defs>` and `<use href="#id">`.
- Keep it under 300,000 characters.
- Don't invent steps, labels or facts the brief doesn't give.
- Before replying, check: every panel has a scene, a number and a caption;
  nothing overlaps or is clipped; the panels are in the brief's order.
