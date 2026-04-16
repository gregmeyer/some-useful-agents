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

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) for full documentation.

## License

MIT
