---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Test reliability: secrets stores accept an explicit scrypt cost for new stores.

`EncryptedFileStore` takes an optional `kdfParams` (held to the same bounds as a stored payload) that applies only when it creates a store; the default stays N=2^17. Tests use the minimum, which stops the secrets suites timing out under a parallel test run. No change for real stores.
