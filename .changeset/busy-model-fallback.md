---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A busy model tries a fallback model, then the next provider, and failures say why.

When a provider's model is busy (OpenAI's "Selected model is at capacity", Anthropic's 529 overloaded, "servers are busy"), sua now classifies it as `model_busy` instead of an unknown error, which used to stop the waterfall dead. The same provider first tries its fallback model once (new **If it's busy** picker on each provider in Settings → LLM, stored as `fallbackModels`; Claude defaults to Sonnet), then the next provider. A node whose attempts all fail says what each one ran into in words, and sua's reply in a conversation says why it couldn't answer and what to do, instead of "I hit a triage failure".
