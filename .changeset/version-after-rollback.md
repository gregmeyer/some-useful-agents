---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

An agent rolled back to an older version can be changed again.

A new version was numbered current + 1, which after a rollback is a version that already exists, so every save failed with "UNIQUE constraint failed: agent_versions.agent_id, agent_versions.version": a settings save, a fix sua applies, or `sua agent reimport`. New versions now go after the newest one, and Settings' "Save as vN" names that number.
