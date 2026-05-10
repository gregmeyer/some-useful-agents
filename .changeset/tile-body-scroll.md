---
"@some-useful-agents/dashboard": patch
---

Pulse tile body now scrolls; chrome (header + footer) stays pinned.

The previous fix for tall interactive-widget tiles used a sticky footer, which sat on top of the form's last input and obscured it because both used the same surface colour. New layout splits the tile into a static frame (header + footer + resize handle) and a `.pulse-tile__body` wrapper that owns the scroll. The agent link in the footer now stays reachable AND visually separate from the form, regardless of widget content height.

Same `.pulse-tile__body` class the home widgets already used; CSS adds `flex: 1; min-height: 0; overflow-y: auto` plus a flex column with the existing gap so renderers don't have to think about it.
