---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Every shipped agent's shell steps use the shared sua_helpers.

account-research, firmographic-research, lever-job-agent, notebook-checker, notebook-finder and starter-research drop their own copies of upstream(), last_obj(), block() and last_json() for the shared ones (new: `tagged_json()`). lever-job-agent's steps now read a long upstream result from its file instead of the cut-short copy. A test keeps any shipped agent from growing its own copy again.
