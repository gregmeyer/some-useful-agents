---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Stop hostname changes from locking you out of your own secrets.

The encrypted secrets store's fallback ("obfuscated") mode keyed off
`hostname:username`. On macOS `os.hostname()` flips between e.g. `Mac-mini` and
`Mac-mini.local` on network changes, which silently changed the key and made
agent runs fail with a raw `unable to authenticate data` crypto error.

The fallback now derives from a stable per-vault machine key (a random value
stored 0600 next to the vault), so it no longer depends on the volatile
hostname. Existing hostname-keyed vaults are read via the old seed and
transparently re-keyed to the stable key on first read (self-heal) — no manual
migration. When a vault genuinely can't be decrypted, the error is now
actionable ("the machine identity that wrote it is no longer available… restore
a backup, or `sua secrets migrate`") instead of a raw crypto failure. For real
encryption (vs obfuscation), a passphrase is still the recommended path.
