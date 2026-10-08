---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

An llm step gets the whole of a big upstream result, and a claude step that runs out of turns no longer reports as rate limited.

An upstream result over 32 KB was cut short in `{{upstream.<id>.result}}`, ending with a pointer to a file holding the rest. A one-turn llm step tried to read that file, ran out of turns, and the failure was reported as `rate_limited`: claude's event stream carries a rate-limit status on every run, and the failure check read the whole stream. Prompts now read the full result from the file (up to 256 KB), claude failures report the CLI's own error (e.g. `error_max_turns: Reached maximum number of turns (1)`), and a 429 has to stand alone to count as a rate limit.
