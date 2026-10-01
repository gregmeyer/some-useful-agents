---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Edit the tool policy in Settings → Policies.

Add, edit, reorder and delete rules, set the default action, or edit the whole file as JSON, with one-step Undo. Saves are validated first (the editor never writes a file that would block every tool call), refused if the file changed since you opened the page, and apply on the next tool call. An invalid file can now be fixed from the dashboard. Core gains `savePolicyDocument`, `savePolicyText`, `restorePolicyBackup` and `policyFileVersion`.
