---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Correct a notebook in its conversation, and sua works out what that changes.

Say "she's COO now, not VP Ops", or "that talking point is wrong, she never said that", in a notebook's conversation. sua's new correction agent (`notebook-correction`) reads the notebook, with an id on every part and each part marked as evidence, a judgment, or a rule you set. It finds the smallest change you meant and what that change touches. Code checks the agent's answer against the notebook and follows what cites what, so nothing that rests on the change is missed, and evidence is never dropped for another part's change. sua shows a card: the change, what it rewrites, takes out or looks at again, and how much it keeps. Nothing changes until you press Apply. When it can't tell what you meant, sua asks one question instead.

Applying it changes the fact and keeps it as yours, so a later look doesn't change it back. Questions that rest on the old value come out. Talking points that rest on it are written again in their places, and the other points stay as they are. Findings and plan items you say are wrong come out, and are remembered so they aren't written again. This first version applies corrections to facts about who a notebook is about, and to what sua wrote. Corrections to an option's facts still go through the notebook's own correction.
