---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

mcp-server: `run-agent` accepts inputs.

The MCP `run-agent` tool now takes an optional `inputs` map so MCP clients (Claude Desktop, Claude Code, Cursor) can run agents that declare an `inputs:` block, not only the input-less ones. Values are validated through the same path as dashboard / CLI / scheduler runs (type checks, enum membership, undeclared-key rejection, missing-required errors). Validation failures surface as MCP `isError: true` with the user-readable message instead of a generic 500.

Two defensive caps live at the MCP boundary specifically: 8 KB per value, 64 KB total. Dashboard / CLI / scheduler are unaffected. The `list-agents` tool now also returns each agent's declared input schema (type, required, default, enum values) so callers can introspect what to pass.

Known follow-up: shell agents that interpolate raw inputs into command strings via `{{inputs.X}}` (or unquoted env-var expansion) are vulnerable to injection regardless of trigger source. Tracked separately for a hardening pass at the substitution layer.
