---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

The model sees what web-screenshot took.

A screenshot taken by a model is now handed to it as pictures (the first screen, or the top of the page in up to 3 readable views): claude and codex get them as image content in the tool result. An OpenAI-compatible provider gets them when marked `vision: true` in its settings (new knob, off by default); otherwise its result says they weren't shown. The pictures go to the model only, never into the run's outputs or trace.
