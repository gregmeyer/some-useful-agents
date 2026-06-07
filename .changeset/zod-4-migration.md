---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Migrate core schemas to zod 4.

`@some-useful-agents/core` now depends on zod 4 (4.4.3). The only breaking change
that touched our code was `z.record(valueSchema)` → `z.record(z.string(), valueSchema)`;
applied across the agent / tool / config schemas. Validation behavior is unchanged
(full schema test suite green). The MCP server stays on zod 3 to match the
`@modelcontextprotocol/sdk` types (its bundled `zod-to-json-schema` pins zod 3);
the two never exchange zod schema instances, so the split is safe.
