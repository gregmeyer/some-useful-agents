# ADR-0007: Encrypted file secrets store with machine-bound key

## Status
Superseded by [ADR-0014](0014-passphrase-kek-secrets-store.md) (v0.10.0).

The machine-bound key described here is now the `obfuscatedFallback` branch of the v2 payload — preserved for zero-friction `npx init` demos, labeled loudly as obfuscation-grade in the file and in `sua doctor --security`.

## Context

Agents need to reference secrets (API keys, webhook URLs, tokens) without
those values ending up in YAML that gets committed or shared. Options:

1. **Plaintext `.env` file** — familiar, but every AI coding tool now reads
   `.env` automatically, and committing it by mistake is a recurring
   production outage in the industry. Not acceptable for a tool that
   actively encourages storing secrets.

2. **OS keychain** (macOS Keychain, libsecret, Windows Credential Manager)
   via a Node wrapper like `keytar` — strongest security but adds a native
   addon dependency. Native addons break on various platforms (musl libc,
   Alpine containers, Node version mismatches, Windows without Visual
   Studio Build Tools).

3. **Encrypted file** — store a ciphertext blob. Requires a key. For a
   single-user local tool, deriving the key from something machine-specific
   (hostname + username) is the usual pattern.

For v1 we wanted something that works **everywhere** without asking users to
install native toolchains.

## Decision

Use an encrypted file at `<dataDir>/secrets.enc` with AES-256-GCM. Key
derived via scrypt from `hostname + userInfo().username`. File permissions
`0600`. Versioned payload format so we can migrate later.

This is **obfuscation-grade**, not vault-grade. It prevents:

- Accidental exposure via `cat`, `less`, search-indexer, or AI tooling
- Cross-user reads on shared machines

It does **not** prevent:

- An attacker with your hostname + username + filesystem access
- Memory-dump attacks
- Anything beyond casual read

OS keychain integration is planned as Phase S3, optional and auto-detected.

## Consequences

**Easier:**
- Zero native deps. Pure Node `crypto`. Works in Docker, CI, on every
  platform Node supports.
- Single-file backup: copy `secrets.enc` to a new machine with the same
  hostname+username and it decrypts. (Which is also a weakness.)

**Harder:**
- Secrets do NOT portably roam across machines. Moving to a new machine
  requires re-running `sua secrets set` for each value.
- Loss of the file = loss of all secrets. No recovery path other than the
  original source of truth.

**Trade-offs accepted:**
- Obfuscation-grade is good enough for a local playground. Users with real
  security needs can wait for the OS keychain integration (Phase S3) or
  bring their own vault via `.env` pointing to `$(vault read ...)` output.
