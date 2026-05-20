---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Two fixes for the agent-drafter:

- **Drafter prompt**: explicit STRICT rule about multi-line shell commands needing the YAML literal block scalar (`command: |` with indented body). The drafter was producing inline `python3 -c "..."` blocks that broke YAML parsing with "Implicit keys need to be on a single line."
- **Orchestrator parse**: run `autoFixYaml` on the drafter's output before `parseAgent`, matching what the commit endpoint already does. Absorbs common LLM YAML mistakes (camelCase outputs, double-brace templates in shell nodes, etc.) so drafts don't fail validation on issues the autofixer would have caught downstream anyway. The autofixed YAML is stored on the draft so commit doesn't re-fix.
