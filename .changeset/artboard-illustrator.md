---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Illustrated artboards that are actually drawn, and pictures that land in the answer they're for.

Graphics creator can only fill the graphics server's templates, so "illustrated steps" came out as numbered text boxes. A new **Artboard illustrator** example agent draws the artboard itself as an SVG (each panel a small scene with its caption), following a new shipped `drawing-artboards` skill plus any skill you name, and a new built-in tool, **`picture-from-svg`**, cleans the drawing (no scripts, handlers, embedded pages or outside fetches) and turns it into a PNG kept with the run. sua is told to use it when you want drawings.

A finished run's picture in a conversation about one answer now goes into that answer by itself, and the conversation says so. Under the picture: "In [answer] · Remove", or one **Add to [answer]** button with the others behind **Another answer** (no more select of every answer); a picture is added to an answer once. The widget's repeated "Open Output" link is gone. An answer's brief (on screen, downloaded and as a PDF) shows its pictures in a **Pictures** section.
