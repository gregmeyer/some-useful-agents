# Conversations with an agent

You can talk to an agent and follow up: "compare rail and bus to Porto", then "which is cheaper?". Each message is one ordinary run of the agent, and the agent sees the conversation so far.

Works for any agent with a text input for the message. Where to talk to it:

- **Dashboard:** the **Chat** tab on the agent's page.
- **Terminal:** `sua agent chat <agent>`.
- **MCP** (Claude Desktop and other clients): `run-agent` with `message` and `sessionId`.

## Which input the message fills

1. `chat: { input: NAME }` on the agent, when set.
2. Otherwise the agent's only **required** string input.
3. Otherwise its only string input.

If none of these picks one input, the agent says what to add: a string input, or `chat:` to choose between several. Other inputs keep their defaults, or you pass them with each message (`--input` in the terminal, `inputs` over MCP).

```yaml
id: trip-helper
name: Trip helper
inputs:
  QUESTION: { type: string, required: true }
  CURRENCY: { type: string, default: EUR }
chat: { input: QUESTION }      # optional here: QUESTION is the only required string input
nodes:
  - id: answer
    type: goal
    goal: "Answer the user's travel question: {{inputs.QUESTION}}. Prices in {{inputs.CURRENCY}}."
    tools: [web-fetch]
```

## What the agent sees

Before the first model call of a turn, sua puts the earlier turns in front of every llm and goal node's prompt:

```
CONVERSATION SO FAR (your earlier turns with this user, oldest first; the new message is below — answer it in light of these):
User: Compare rail and bus from Lisbon to Porto
You: Rail takes 3h and costs about 40 EUR; the bus takes 3.5h and costs about 25 EUR.
END OF CONVERSATION SO FAR
```

- It keeps the most recent turns that fit in 8 KB, and each turn is cut at 2000 characters. When older turns are left out, the block says how many.
- It is added after templating, so text in earlier messages is never expanded as `{{…}}`.
- A turn whose run failed shows as "no reply: that run failed …", so the agent knows the question was not answered.
- Shell and tool nodes don't see it; they get the message through the input as usual.
- It comes after the agent's behaviors and its [memory](memory.md) recall. Memory lasts across every run of the agent; a conversation is one thread.

This works the same on every provider (claude, codex, OpenAI-compatible models such as a local Qwen, Apple Foundation Models) and on a Temporal worker, because it is plain text, not provider session state.

## Live replies in the dashboard

The Chat tab talks to the dashboard over a WebSocket (`/ws`), so a reply shows up as it's produced:

- **Text streams in** as the model writes it with Claude (it sends small pieces). Codex and OpenAI-compatible endpoints send each message whole, so with them you see each message arrive, plus the tool calls as they happen.
- **Tool calls** appear under the reply while it's being worked on (`→ web-fetch …`, in red if one failed).
- When the turn ends, the conversation re-renders from what was stored, so the finished reply is formatted exactly as it is on reload.
- A dropped connection reconnects by itself and picks up the events it missed. Without WebSocket support the tab falls back to sending the form and reloading until the reply lands.
- On the durable (Temporal) backend, progress isn't relayed yet; the tab polls until the reply is recorded.

The socket uses the dashboard session (cookie), the same Host check as every page, and requires an allowed `Origin`, so another site can't open it in your browser. It accepts at most 64 KB per message and 120 messages a minute. The wire protocol is documented in `packages/dashboard/src/lib/chat-socket.ts`; see [ADR-0046](adr/0046-chat-over-websocket.md).

## Terminal

```bash
sua agent chat trip-helper                       # interactive: type, Enter; empty line or Ctrl-D ends
sua agent chat trip-helper -m "rail or bus to Porto?"    # one message, prints the reply and the session id
sua agent chat trip-helper --session 1a2b3c4d -m "which is cheaper?"
sua agent chat trip-helper --list                # this agent's conversations
sua agent chat trip-helper --session 1a2b3c4d --show
```

## MCP

`run-agent` takes `message` and, from the second turn on, `sessionId`:

```json
{ "name": "trip-helper", "message": "rail or bus to Porto?" }
→ { "sessionId": "1a2b3c4d", "id": "<run id>", "status": "completed", "reply": "…" }

{ "name": "trip-helper", "message": "which is cheaper?", "sessionId": "1a2b3c4d" }
```

Only agents managed in the database (not legacy v1 YAML agents) can hold a conversation, and, as with any `run-agent` call, only agents with `mcp: true`.

## Storage

Conversations live in the run database (`sessions` and `session_turns`), so Temporal workers and the dashboard share them. Each agent reply links to its run. Deleting a conversation keeps its runs; deleting the agent deletes its conversations.

Design notes: [ADR-0039](adr/0039-conversations-by-transcript.md).
