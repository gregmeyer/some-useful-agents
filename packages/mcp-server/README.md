# @some-useful-agents/mcp-server

MCP server for some-useful-agents. Exposes agents marked `mcp: true` to Claude Desktop and other MCP clients over HTTP/SSE transport.

## Start

```bash
sua mcp start
```

Binds `127.0.0.1:3003` by default. Bearer token auth via `~/.sua/mcp-token`.

## MCP client config

```json
{
  "mcpServers": {
    "some-useful-agents": {
      "url": "http://127.0.0.1:3003/mcp",
      "headers": {
        "Authorization": "Bearer <token from ~/.sua/mcp-token>"
      }
    }
  }
}
```

`run-agent` also holds conversations: pass `message` (and the returned `sessionId` to continue). A run that stops to ask you something reports `waiting`; answer in the dashboard inbox. See [docs/conversations.md](https://github.com/gregmeyer/some-useful-agents/blob/main/docs/conversations.md).

`board-read` and `board-place` let the client arrange a board (Pulse or a named dashboard): its sections, tabs, rows, grids and tiles, saved as a version you can undo from the board page. Your tool policy applies. `build-board` builds a whole board from a request (sua picks the agents, lays it out, runs it, and drafts agents for anything missing, which you approve in the inbox); `board-build-status` follows it. See [docs/tools/board-place.md](https://github.com/gregmeyer/some-useful-agents/blob/main/docs/tools/board-place.md).

`surface-read` and `surface-apply` read and change how Home is arranged (its goal, rules, pins and hides; changes to its sections are left to the person). `items-read` lists what needs the person's attention right now, most urgent first: threads waiting on them, questions runs are waiting on, agents that keep failing or missed their outcome, drafts, board builds and the scheduler's health. Each item has a stable id and the actions it supports. See [docs/surfaces.md](https://github.com/gregmeyer/some-useful-agents/blob/main/docs/surfaces.md).

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) for full documentation.

## License

MIT
