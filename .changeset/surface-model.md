---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

The surface model: a goal, rules and your pins, versioned (goal surfaces, S2).

Core gains surface documents (regions, rules, overrides), one way to change them, a versioned store, and a compiler that turns a surface plus items into ordered regions with plain reasons. `applySurfaceOps` takes the same ops from a gesture, from sua, or from an agent. Changes to regions themselves wait for your approval. `SurfaceStore` keeps every version with who made it and why, refuses stale writes, and undoes by restoring. `compileSurface` orders each region (your pins, then your ranks, then promote rules, then urgency) and says why each item is placed and why others are hidden. Nothing draws it yet; Home's surface (S3) does next. See docs/surfaces.md.
