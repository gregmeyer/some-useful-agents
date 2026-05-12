---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Replace Gmail OAuth with a generic `mcp-tool` integration kind

Reverses #264 (OAuth + Gmail) in favour of delegating OAuth-backed
services to already-connected MCP servers. Claude (and Claude Desktop)
already handles the OAuth handshake for Gmail, Calendar, Drive, Notion,
Linear, etc.; sua doesn't need to re-broker.

**Removed:** every Gmail / OAuth code path — `packages/core/src/oauth/`
(PKCE + state store + Google driver), the `/oauth/callback` +
connect/disconnect routes, the `gmail` notify handler, the Gmail setup
guide in the integrations UI, and all the supporting tests. No
external API surface left.

**Added:** an `mcp-tool` integration kind that pairs an MCP server
(from `/settings/mcp-servers`) with a specific tool name + optional
default inputs. Notify handlers reference it via:

```yaml
notify:
  on: [failure]
  handlers:
    - type: mcp-tool
      integration: user:gmail-via-mcp
      inputs:
        body: "Run {{run.id}} failed: {{run.error}}"
```

The dispatcher merges `default_inputs` from the integration row with
the handler's `inputs` (inline wins), runs template substitution for
`{{vars.X}}`, `{{agent.id}}`, `{{run.id}}` etc., and calls
`callMcpTool()` against sua's existing pooled MCP client — the same
primitive in-DAG MCP tool nodes use, so notify dispatch reuses the
connection pool.

**Trust model:** zero new secret surface. The MCP server's auth lives
in `mcp_servers.env_json` / `url` already; sua never touches the
underlying credentials.
