# board-read and board-place

Let an agent read and arrange a [board](../boards.md): Pulse (`pulse`) or a named dashboard (`user:morning-briefing`, …). Both are built in; add them to a node's `tools:`.

```yaml
nodes:
  - id: arrange
    type: llm-prompt
    tools: [board-read, board-place]
    prompt: |
      Read the board "user:morning-briefing", put the weather tile top left at 2x1,
      and add a heading "Today" above it. Pass the version you read.
```

The same two tools are offered to MCP clients (Claude Desktop, Codex…) by `sua mcp`.

## board-read

| Input | Type | Required | Description |
|---|---|---|---|
| `board` | string | no | Board id. Empty lists the boards you can arrange. |

Returns the board's `version` and its items, one per line: `[id] agent weather-forecast at x=0 y=1, 6x5`. The grid is 12 columns wide and each row is 40px. A dashboard that has never been arranged is shown laid out from its sections (version 0).

## board-place

| Input | Type | Required | Description |
|---|---|---|---|
| `board` | string | yes | Board id |
| `changes` | array | yes | Changes, applied in order (below) |
| `version` | number | no | The version you read. If the board changed since, nothing is saved. |

Each change is one of:

| Change | Effect |
|---|---|
| `{"op":"add","kind":"agent","agentId":"…","size":"2x1"}` | Add an agent's tile. Sizes `1x1` (3×5 cells), `2x1` (6×5), `1x2` (3×10), `2x2` (6×10); or give `w`/`h`. Without `x`/`y` it goes in the first free spot. |
| `{"op":"add","kind":"heading","text":"…"}` | Add a full-width heading (at the bottom, or at `y`). |
| `{"op":"add","kind":"note","text":"…"}` | Add a short note (`**bold**`, `*italic*`, `` `code` ``). |
| `{"op":"move","id":"…","x":0,"y":0}` | Move an item. Dropping onto another item's spot pushes it down. |
| `{"op":"resize","id":"…","w":6,"h":5}` | Resize an item. |
| `{"op":"remove","id":"…"}` | Remove an item. |

`id` is an item id from `board-read`; for an agent tile its agent id works too. Tiles never overlap and float up into gaps after every change.

All changes are saved together as a new version, which the person can undo from the board page (**Undo last save**). Nothing is saved when any change is invalid, an agent isn't installed, or the board changed since `version`; the tool says which.

## Policy

The board id is the tool's resource, so a [tool policy](../tool-policies.md) rule can limit which boards an agent may arrange:

```json
{ "tool": "board-place", "resources": ["pulse"], "effect": "deny", "reason": "Pulse is arranged by hand." }
```

The rule applies to MCP clients too.
