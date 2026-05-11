---
"@some-useful-agents/mcp-server": minor
---

`startMcpServer` now accepts `port: 0` and returns the kernel-assigned port on the handle.

`McpServerHandle` gains a `port` field — same as `options.port` when the caller asked for a specific port; the OS-assigned port when the caller passed `port: 0`. The Host/Origin allowlist is rebuilt after the listen completes so requests against the bound port are accepted.

Internal: tests in `packages/mcp-server/src/server.test.ts` now use this, eliminating the random-port-pool collision that surfaced as intermittent `UND_ERR_SOCKET` flakes on CI.
