---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix two issues found dogfooding the inbox-triage action loop in-browser.

- **Triage hit max-turns**: with `maxTurns: 1` and no tool-use policy
  in the prompt, the LLM probed the filesystem (Bash + Read + Glob)
  before responding and timed out. Tightened the prompt with an
  explicit "do not use Bash/Read/Grep/Glob; the inputs are
  authoritative" instruction and bumped `maxTurns` to 2 as a safety
  buffer.

- **AGENT_YAML enrichment silently no-op'd in the demo**: the inbox
  demo seed referenced `agentId: demo-failing-agent` but no such
  agent was installed. The route's enrichment skipped (correctly),
  leaving `agent-analyzer` to fail with "Missing required input
  AGENT_YAML". The demo seed now installs a stub `demo-failing-agent`
  YAML that intentionally references `shell-exec` (matches the demo
  message body "shell-exec: command not found") so the analyzer has
  a real failure to diagnose.

Verified end-to-end: triage proposes the action card, operator clicks
Run, agent-analyzer runs with auto-injected AGENT_YAML + LAST_RUN_OUTPUT,
result lands in the thread, triage re-fires for a summary turn.
