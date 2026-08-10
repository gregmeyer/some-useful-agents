---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix: the llm-prompt `tools` field was silently dropped when an agent was saved.

The node `tools` field (registry tool ids an OpenAI-compatible model may call
mid-generation) was declared in the schema, types, and runtime, but the YAML/DB
(de)serializer in `agent-yaml.ts` enumerates node fields explicitly and was
missing `tools` — so it survived in-memory but was stripped on every parse /
export / reimport / dashboard save. The result: an agent authored with
`tools: [...]` ran as a plain completion (no tool loop), and the model answered
from memory instead of calling the tool. Added `tools` to both the node
reconstruction map and the export key order, with a round-trip regression test.
