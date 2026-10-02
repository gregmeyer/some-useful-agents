# board-read and board-place

Let an agent read and arrange a [board](../boards.md): Pulse (`pulse`) or a named dashboard (`user:morning-briefing`, …). A board is an A2UI canvas, a tree of sections, tabs, rows, grids and tiles, and these tools work on that tree with the same operations as the **✎ Arrange** editor. Both are built in; add them to a node's `tools:`.

```yaml
nodes:
  - id: arrange
    type: llm-prompt
    tools: [board-read, board-place]
    prompt: |
      Read the board "user:morning-briefing". Put the weather tile in a new
      section "Outside" at the top, two columns wide. Pass the version you read.
```

MCP clients (Claude Desktop, Codex…) get the same two tools from `sua mcp`.

## board-read

| Input | Type | Required | Description |
|---|---|---|---|
| `board` | string | no | Board id. Empty lists the boards you can arrange. |

Returns the board's `version` and an outline of its tree, one node per line with its id:

```text
Board "Morning Briefing" (user:morning-briefing), version 3, 5 tiles:
[root] board (column)
  [section_1] section "Morning Glance"
    [grid_1] grid
      [tile_s0t0] tile daily-greeting "Morning Greeting"
      [tile_s0t1] tile weather-forecast "Weather" (spans 2 columns; cell cell_s0t1)
  [tabs_4] tabs
    tab "Sports":
      [section_2] section "MLB"
        …
```

A board that has never been arranged is shown laid out from the dashboard's sections (Pulse: empty, everything else is under "Everything else" on the page). The result also carries the board's A2UI document (`board.doc`).

## board-place

| Input | Type | Required | Description |
|---|---|---|---|
| `board` | string | yes | Board id |
| `ops` | array | yes | Operations, applied in order (below) |
| `version` | number | no | The version you read. If the board changed since, nothing is saved. |

| Operation | Effect |
|---|---|
| `{"op":"insert","parent":ID,"index"?:N,"node":{…}}` | Add a node into a container (`root`, a section, grid, row, column, tabs or card). Nodes: `{"type":"tile","agentId":"…"}`, `{"type":"system","tileId":"_system-…"}`, `{"type":"section","title":"…"}` (a section holding a grid), `{"type":"heading","text":"…"}`, `{"type":"note","text":"…"}`, `{"type":"grid"}`, `{"type":"row"}`, `{"type":"column"}`, `{"type":"tabs","title"?:"…"}`, `{"type":"card"}`. Inserting into tabs adds a tab. |
| `{"op":"move","id":ID,"parent":ID,"index"?:N}` | Move a node (a tile takes its span with it). |
| `{"op":"remove","id":ID}` | Remove a node and everything in it. |
| `{"op":"wrap","id":ID,"in":"section\|card\|row\|column\|tabs","title"?:"…"}` | Put a node inside a new container. |
| `{"op":"unwrap","id":ID}` | Put a container's contents where it was. |
| `{"op":"set","id":ID,"props":{…}}` | `title` (section), `text` (heading/note), `minWidth` (grid, px), `palette` (tile: `default`, `dark`, `light`, `accent-teal`, `accent-red`, `accent-green`), `tabTitles` (tabs). |
| `{"op":"span","id":TILE,"span"?:1-4,"rows"?:1-4}` | How many columns and rows a tile takes in its grid. |

All operations are checked and saved together as a new version, which the person can undo from the board (**Undo last save**). Nothing is saved when any operation can't be applied (an unknown id, moving something into itself, removing the root), when it would add an agent that isn't installed, or when the board changed since `version`; the tool says which.

## Policy

The board id is the tools' resource, so a [tool policy](../tool-policies.md) rule can limit which boards an agent may arrange:

```json
{ "tool": "board-place", "resources": ["pulse"], "effect": "deny", "reason": "Pulse is arranged by hand." }
```

The rule applies to MCP clients too.
