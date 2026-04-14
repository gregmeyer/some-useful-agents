---
"@some-useful-agents/cli": minor
"@some-useful-agents/core": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

**security: passphrase-based KEK for the secrets store (v0.10.0).** Closes the last finding from the original `/cso` audit. `data/secrets.enc` now encrypts under a key derived from a user passphrase via scrypt (N=2^17, r=8, p=1) with a per-store random salt, instead of the v1 hostname+username seed. A payload-exfil attacker can no longer decrypt the store by guessing trivially-known machine attributes.

### What changed

- New v2 payload format: `{ version: 2, salt, iv, tag, data, kdfParams, obfuscatedFallback? }`. Salt and KDF parameters live alongside the ciphertext so we can tune scrypt upward in future versions without breaking old stores — readers honor whatever the file says.
- Passphrase prompt on `sua secrets set` against a cold or v1 store. Confirmed twice before write. An empty passphrase explicitly opts into the legacy hostname-derived key and writes `obfuscatedFallback: true` into the payload so every subsequent read loudly warns.
- New `sua secrets migrate` command: decrypt a v1 or v2-obfuscatedFallback store with the legacy key, re-encrypt under a new passphrase. Atomic via tempfile + rename.
- `sua doctor --security` reports the store's encryption mode: `v2 passphrase-protected` (green), `v2 obfuscatedFallback` / `legacy v1` (red, points at `sua secrets migrate`).
- `SUA_SECRETS_PASSPHRASE` environment variable is read by every code path that opens the store — required for CI/non-TTY contexts running scheduled agents against a v2 passphrase-protected store.
- Legacy v1 payloads still decrypt for reads (with a warning on every load). First write auto-migrates to v2 under whatever passphrase the caller provides; run `sua secrets migrate` to upgrade without having to set a new secret first.

### Migration

If you have an existing v0.9.x install with a `data/secrets.enc` on disk:

```bash
# Option A: explicit migrate
sua secrets migrate

# Option B: auto — the next `sua secrets set` or `sua secrets delete` migrates
sua secrets set ANY_KEY
```

Both routes prompt for a new passphrase (or accept an empty one to stay on the legacy hostname key with an on-by-default warning).

### CI / non-TTY

Set `SUA_SECRETS_PASSPHRASE` in the environment. A non-TTY `sua secrets set` against a cold store without the env var exits 1 with a clear error. If you want to preserve the pre-v0.10 zero-friction behavior, set `SUA_SECRETS_PASSPHRASE=` (explicit empty string) — this is treated as "use the legacy hostname-derived key" and is labeled as such in both the payload and in `sua doctor --security`.

### Rejected alternatives

- **`keytar` / OS keychain** — native dependency that breaks `npx` on fresh machines (libsecret missing on Linux, Rosetta issues on M-series Macs). We may revisit with a pure-JS implementation later; for now, passphrase with empty-fallback covers the threat model without native bindings.
- **Auto-derived "machine key" from additional attributes** — still guessable for a targeted attacker. Passphrase is the honest primitive.

### Not in this release

- `sua secrets rotate-passphrase` — planned for v0.11 or later.
- Keyfile-as-alternative-to-env-var (`SUA_SECRETS_KEYFILE`) — planned for v0.11 or later.
- Dashboard badge for store encryption mode — v0.11.0 consumes the state surfaced by this release.
