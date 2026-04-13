---
"@some-useful-agents/cli": patch
---

Three small but visible improvements:

1. **Suppress the `node:sqlite` ExperimentalWarning.** Every `sua` command was printing `(node:XXXX) ExperimentalWarning: SQLite is an experimental feature...` because we use the built-in `node:sqlite` module. The CLI now filters that specific warning while letting every other warning through. When the minimum Node version eventually moves to 24+, where sqlite is stable, this becomes a no-op.

2. **Rewrite the README.** Reflects the v0.3 command surface (including `sua tutorial`, `sua schedule`, `sua secrets`), shows a real agent YAML with chaining + scheduling + secrets, notes known-weak security spots with links to ADRs, and points at the ROADMAP + ADR dir.

3. **Expand ROADMAP.md.** Added daemon mode / unattended operation, tutorial resume, parallel agents / swarms, and a formal security audit as explicit "Next" items.
