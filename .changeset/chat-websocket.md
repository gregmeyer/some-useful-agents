---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agent chat streams live over a WebSocket.

The Chat tab now sends messages over a WebSocket (`/ws`) and shows the reply as it's produced: Claude's text streams in as it's written, tool calls appear as they happen, and the finished reply then renders as stored. Reconnects pick up missed events; without a socket the old form-and-reload path still works. The socket uses the dashboard session, the Host allowlist and a required allowed Origin. Claude now runs with `--include-partial-messages` (new `output_delta` progress, delivered live but not stored).
