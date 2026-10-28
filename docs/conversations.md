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

The Chat tab and inbox threads talk to the dashboard over one WebSocket per tab (`/ws`), so a reply shows up as it's produced:

- **Text streams in** as the model writes it with Claude (it sends small pieces). Codex and OpenAI-compatible endpoints send each message whole, so with them you see each message arrive, plus the tool calls as they happen.
- **Tool calls** appear under the reply while it's being worked on (`→ web-fetch …`, in red if one failed).
- **Scroll up while it writes:** a streaming reply follows the end of the conversation until you scroll up, then stays where you are. Scroll back to the bottom, or send a message, and it follows again.
- When the turn ends, the conversation re-renders from what was stored, so the finished reply is formatted exactly as it is on reload.
- A dropped connection reconnects by itself and picks up the events it missed. Without WebSocket support the tab falls back to sending the form and reloading until the reply lands.
- On the durable (Temporal) backend, the reply's text, tool calls and widgets arrive about once a second, read back from the worker (see [temporal.md](temporal.md)), and the conversation hears when the turn ends.
- **Widgets:** if the agent declares a [view](a2ui-views.md), each reply shows it, and clicking a button in it sends the next message.
- **Widgets inside a reply** (`<a2ui>` blocks, see [a2ui-views.md](a2ui-views.md#in-chat-replies-are-widgets-clicks-are-messages)) draw in place wherever the conversation is shown: the agent's Chat tab, the sua panel and Home. Clicking a button in one sends its message as your next reply, in every one of those places. It goes through the reply box, so nothing happens while a reply is still being written. Once you've said something after a reply, its buttons are spent: the widget is drawn quieter, can't be clicked again, and the button you picked reads "✓ …". Images in a conversation's widgets follow the agent's `permissions.imgSrc`, as on its Chat tab.
- **Inbox threads** use the same socket: replies you post go over it, and sua's answer (streamed word by word with Claude, its widget drawn as it's written), action cards and status changes arrive on it (`inbox:<thread>` channel). Without a socket the thread falls back to its server-sent-events stream and plain posts. The inbox list and the unread badge still use their page-wide event stream.
- **Update a briefing** ("rerun the briefing", "check what you found since last time"). sua offers one **Update it** card: it looks again, searches again and writes again, in order, then says what's new since the last run ([notebooks.md](notebooks.md)).
- **Start a notebook from a template** ("start a notebook from my Job search template, controller roles in Denver"). sua asks what's different this time, one or two questions at a time with button answers, then offers a card that creates it ([notebooks.md](notebooks.md#templates)).
- **Ask sua to open a page** ("open my notebook", "take me to that agent") and it does: the page behind the panel goes there and the same conversation stays open beside it, even on a notebook, which otherwise brings its own conversation. It happens once, when the reply arrives. Reloading or reopening the thread doesn't move you again. Only dashboard paths are opened.

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

Conversations live in the inbox store in the run database: each one is an inbox thread with source `conversation`, and each turn is a reply on it (yours as `user`, the agent's as `agent`). Temporal workers and the dashboard share them. Each agent reply links to its run. Deleting a conversation keeps its runs; deleting the agent deletes its conversations.

They're listed under **Chats** in the inbox and the sua panel, alongside conversations with sua.

Upgrading from 0.29 or earlier copies existing conversations over the first time sua opens the database, keeping their ids (so `--session <id>` still works). The old tables stay as `sessions_legacy` and `session_turns_legacy`.

Design notes: [ADR-0039](adr/0039-conversations-by-transcript.md), [ADR-0048](adr/0048-conversations-in-the-inbox-store.md).

**An agent's conversation in the panel.** Opened in the sua panel (⌘K) or on Home, an agent's conversation stays the agent's: what you type goes to the agent (the box says "Reply to <agent>…"), its reply streams in with any widgets building up, and its replies are labelled with the agent. sua doesn't answer in it.

**While a reply is being written.** A reply in progress shows a pulsing "Working…" wherever it appears. Open an agent's conversation mid-reply (in the panel or on Home) and you see the reply so far, then the rest as it streams; the box says "<agent> is replying…" until it's done. In the conversation lists, a conversation being answered shows a pulsing dot and "sua is working…" or "<agent> is replying…" in place of its last line. The **Chats** tab lists your conversations with agents as well as with sua.
