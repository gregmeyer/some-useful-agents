# ADR-0014: Passphrase-based KEK for the secrets store

## Status
Accepted (v0.10.0). Supersedes [ADR-0007](0007-encrypted-file-secrets-store.md).

## Context

ADR-0007 shipped a secrets store encrypted with `scrypt(hostname + username)` and called it honestly in `docs/SECURITY.md`: **obfuscation, not encryption**. A targeted attacker who can guess the victim's hostname and username — trivial for anyone reading the victim's GitHub profile — can decrypt an exfiltrated `secrets.enc`. The POSIX `0600` permission was doing the real at-rest work; the cipher was theater.

This was the only remaining item from the original `/cso` audit after v0.4.0–v0.6.1 closed transport, trust, shell, and run-store gaps. `docs/SECURITY.md` carried the admission explicitly. Before the dashboard work in v0.11.0 can display a meaningful "secrets status" badge, the underlying security model has to stop being theater.

## Options considered

1. **OS keychain via `keytar`.** Strongest, and ADR-0007 called it out as the planned upgrade. Rejected for v0.10.0: `keytar` is a native addon. Breaks `npx @some-useful-agents/cli` on fresh machines — libsecret missing on Linux, Rosetta-vs-arm64 mismatches on M-series Macs, Node version ABI drift. The onboarding story is "one command gets you running"; a native dep that fails at install time kills that story.

2. **Additional machine-derived entropy** (MAC address, machine-id, install timestamp). Doesn't help. Any attacker who gets `secrets.enc` probably got the whole machine snapshot. Still guessable with the context they already have. This is polishing the obfuscation, not fixing the primitive.

3. **Passphrase-derived key (chosen).** User picks a passphrase; we run `scrypt(passphrase, random-salt-per-store, N=2^17, r=8, p=1)`; that's the AES-256-GCM key. No native deps, strong against file exfiltration, honest about what it protects and what it doesn't.

## Decision

v2 payload format at `data/secrets.enc`:

```json
{
  "version": 2,
  "salt": "<16 random bytes, base64>",
  "iv": "<12 random bytes, base64>",
  "tag": "<16 bytes from AES-GCM, base64>",
  "data": "<ciphertext, base64>",
  "kdfParams": { "algorithm": "scrypt", "N": 131072, "r": 8, "p": 1, "keyLength": 32 },
  "obfuscatedFallback": true  // optional; present when passphrase was empty
}
```

### Empty-passphrase fallback

Plain-vanilla passphrase prompting is hostile to the zero-friction `npx init → sua secrets set` demo flow ADR-0007 deliberately preserved. So: an empty passphrase is a legitimate, documented choice that writes `obfuscatedFallback: true` into the payload, re-derives the key from `hostname:username` (same as v1), and makes every read/write warn. `sua doctor --security` flags the store as `hostname-obfuscated` in red. Users who genuinely don't care about secret-store security get the old behavior; users who want real encryption get it; nobody gets silently degraded security.

### KDF params in the payload

`N=2^17` is the OWASP 2024 scrypt minimum. By storing the params alongside the ciphertext (rather than hardcoding them in the reader), we can raise `N` in v0.11.x or later without breaking existing stores — the reader honors whatever the file specifies. Readers validate against bounds (`N` in `[2^14, 2^20]`, power-of-two, `r ≤ 16`, `p ≤ 4`, `keyLength === 32`) before calling scrypt, so an adversarial file can't trigger an OOM-scale derivation at read time.

### Migration

- v1 payloads still decrypt with the legacy hostname-derived key (warning on every load).
- First `sua secrets set` or `sua secrets delete` after upgrade auto-migrates to v2 under whatever passphrase the caller supplies.
- Explicit `sua secrets migrate` re-encrypts without requiring a value change. Atomic via tempfile + rename.

### CI and non-TTY

`SUA_SECRETS_PASSPHRASE` in the environment substitutes for the interactive prompt. `SUA_SECRETS_PASSPHRASE=` (empty string) is the explicit opt-in to `obfuscatedFallback` for CI scripts that want to preserve pre-v0.10 behavior. `sua schedule start` preflights this and refuses to boot if scheduled agents declare secrets but nothing can unlock the store.

## Consequences

**Easier:**
- `docs/SECURITY.md` no longer has to apologize. Secrets-store encryption is real against a file-exfiltration attacker.
- `kdfParams` in the payload means tuning `N` later is a one-line default change, not a migration event.
- The dashboard (v0.11.0) can surface meaningful state: `passphrase-protected` (green), `hostname-obfuscated` (red), `legacy v1` (red).

**Harder:**
- Forgetting the passphrase loses the secrets. No recovery path. Documented in SECURITY.md under operator responsibilities; a `sua secrets rotate-passphrase` convenience command is on the v0.11+ list.
- CI scripts that piped `echo val | sua secrets set KEY` break without `SUA_SECRETS_PASSPHRASE`. Documented in the v0.10.0 changelog.
- Each scrypt derivation costs ~400ms at `N=2^17`. Instance-level key cache collapses the read→write double-scrypt in `set`/`delete` to one derivation. Across process invocations, the cost is paid each time — this is the honest price of not persisting the key.

**Explicitly rejected:**
- Persisting the derived key anywhere on disk. Defeats the entire point.
- Silently degrading to the old hostname-derived behavior when no passphrase is provided. Every degradation is a loud opt-in with a flag in the payload and a red line in `sua doctor --security`.
- Native keychain deps. The pure-JS keyring space may produce a viable candidate later; revisit then as an optional second backend, not a replacement.
