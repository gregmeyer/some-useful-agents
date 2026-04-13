# Security Model

This document is the source of truth for what `some-useful-agents` defends against, what it does not, and what you are on the hook for as an operator.

Keep it honest. If the code diverges from this document, treat that as a bug in the code or the document — not a tolerable drift.

## Intended use

sua is a **local-first tool for a single user on a machine they control**. Think "the user's laptop" or "a developer's dev box." It is not designed for:

- Multi-tenant hosting (one process serving agents for many users).
- Public-internet exposure of the MCP server or any other sua surface.
- Storage of regulated data (PCI, HIPAA, etc.).
- Untrusted code execution as a security boundary. Shell agents run as the invoking user.

If your use case sounds like any of the above, stop and use a tool built for it.

## Trust model

Three concentric rings, in order of increasing trust:

| Ring | Source | Default treatment |
|------|--------|-------------------|
| `community` | Agents in `agents/community/`, installed from third parties | Hostile-by-assumption. Minimal env allowlist; shell downstream blocked; claude-code output wrapped. |
| `local` | Agents you authored in `agents/local/` | Trusted — yours. Full env allowlist minus secrets. |
| `examples` | Agents bundled with sua in `agents/examples/` | Trusted. Same treatment as `local`. |

Trust flows with the agent's source through the chain executor. A local agent that reads the output of a community agent does not become community, but the value flowing in is tagged as untrusted and handled accordingly (see "Chain trust propagation" below).

## What sua defends against

### MCP server (v0.4.0)

The MCP HTTP server on `localhost:3003` has four layered defenses:

1. **Loopback bind.** `httpServer.listen(port, '127.0.0.1')` by default. A LAN attacker on the same Wi-Fi cannot reach the port. Override with `sua mcp start --host <host>` only when you genuinely need LAN exposure (a warning is printed).
2. **Bearer token auth.** Every `/mcp` POST/GET/DELETE must carry `Authorization: Bearer <token>`. `/health` stays unauthenticated. The token is a 32-byte random value in `~/.sua/mcp-token` (chmod 0600). `crypto.timingSafeEqual` avoids timing leaks on compare.
3. **Host and Origin allowlists.** The server rejects requests whose `Host` header is not in a loopback allowlist (belt-and-suspenders for the `--host` case), and requests whose `Origin` header is present and not loopback (the actual DNS-rebinding defense — a browser tab pointed at `evil.com` that rebinds DNS to 127.0.0.1 still sends its real `Origin`).
4. **Session-to-token binding.** Each `mcp-session-id` is pinned to the sha256 of the bearer token that created it. After `sua mcp rotate-token`, in-flight sessions created under the previous token are refused. No hijack window.

The bearer token's only job is to gate *any process that can hit localhost* from *the user's intended MCP clients*. It is not a credential against a remote attacker — for that we have the loopback bind. Both layers must hold for the system to be safe.

### MCP agent scope (v0.5.0)

Only agents with `mcp: true` in their YAML are exposed via the MCP `list-agents` and `run-agent` tools. Agents without the flag respond as "not found" — not "forbidden" — so a compromised MCP client cannot enumerate the user's full catalog. Use `sua agent list` from the CLI to see everything.

### Shell agent gate (v0.6.0)

Shell-type agents sourced from `community/` refuse to run unless the caller has explicitly opted in. The CLI surfaces this as `--allow-untrusted-shell <name>` on `sua agent run` and `sua schedule start` (repeatable, per-agent, not global). Library consumers pass `LocalProvider({ allowUntrustedShell: Set<string> })` or the equivalent on `TemporalProvider`. The executor throws `UntrustedCommunityShellError` before `spawn` is called, and the provider records a failed run in the store so the refusal shows up in history.

This is a forcing function, not a sandbox. Once you opt in, the shell runs with your full ambient authority. The point is to make you read the `command:` field first. Use `sua agent audit <name>` to print the resolved YAML before opting in.

### Run-store hygiene (v0.6.0)

- `data/runs.db` is chmod 0o600 at create time. Agent stdout can contain secrets that were echoed by an agent; the DB is unencrypted plaintext, so POSIX perms are the only at-rest protection.
- Retention sweep: the store deletes rows older than `runRetentionDays` (default 30) on startup. Configure via `sua.config.json`. Long-running agent history is an ambient leak surface — we cap it unless you opt out.
- Opt-in redaction: set `redactSecrets: true` on an agent's YAML and its captured stdout/stderr runs through a known-prefix scrubber (AWS access keys, GitHub PATs, OpenAI / Anthropic keys, Slack tokens) before it lands in the store. Intentionally narrow patterns — we do not try to scrub "anything long and unusual" because that kind of generic regex produces too many false positives.

### Chain trust propagation (v0.5.0)

When a downstream agent reads `{{outputs.X.result}}` and X is a `community` agent, two defenses kick in:

- **Claude-code downstream:** the substituted value is wrapped in `BEGIN/END UNTRUSTED INPUT FROM <agent> (source=community)` delimiters, and a `[SECURITY NOTE]` is prepended to the prompt telling the LLM to treat wrapped blocks as data rather than instructions.
- **Shell downstream:** refused outright with `UntrustedShellChainError` unless the downstream agent name is in the caller's `allowUntrustedShell` set. When allowed, the shell receives `SUA_CHAIN_INPUT_TRUST=untrusted` so well-written agents can branch; all-local chains see `SUA_CHAIN_INPUT_TRUST=trusted`.

The allow-list is **per-agent, not global**. One careless invocation cannot trust everything.

Env-builder trust levels are *not* downgraded through the chain. A local downstream keeps its full env allowlist even when consuming community output. The reason: a strict `min(source)` rule would push users to silently relabel agents as `local` in their YAML and bypass the MINIMAL_ALLOWLIST that actually protects secrets. Template wrapping at the value level plus the shell hard-block is where the real teeth sit.

### Env filtering by trust level (v0.3)

The env-builder injects a different set of process environment variables based on the agent's source:

- **community:** `PATH`, `HOME`, `LANG`, `TERM`, `TMPDIR` only. `AWS_*`, `*_TOKEN`, `*_KEY`, and any secret-shaped variables never reach the subprocess.
- **local / examples:** the community allowlist plus `USER`, `SHELL`, `NODE_ENV`, `TZ`, and `LC_*`.
- Any agent can declare explicit additions via `envAllowlist:` in its YAML.
- Secrets declared via `secrets:` are resolved from the encrypted store and injected regardless of trust level — but only when the agent explicitly asks for them by name.

See [ADR-0006](adr/0006-env-filtering-by-trust-level.md).

### Cron frequency cap (v0.4.0)

`node-cron` accepts 6-field "with-seconds" expressions silently. That would have let a malicious or typo'd YAML fire an agent every second, melting an Anthropic bill. We reject 6-field expressions by default. 5-field expressions (minimum interval 60s) pass unchanged. Sub-minute scheduling requires `allowHighFrequency: true` in the YAML and logs a `[high-frequency]` warning on every fire.

### Supply chain (v0.4.0)

- Third-party GitHub Actions are pinned to full SHAs with version comments (`actions/checkout`, `actions/setup-node`, `changesets/action`). A compromise of those orgs cannot ship malicious code through a moving tag. Dependabot refreshes the SHAs weekly in its own PRs for review.
- npm publish runs through OIDC trusted publishing via the `npm-publish` GitHub environment. No long-lived `NPM_TOKEN` exists to leak.
- `.github/CODEOWNERS` requires owner review on any change under `.github/workflows/` once the matching branch ruleset is enabled.

## What sua does NOT defend against

Being explicit so you can evaluate whether sua is the right tool for your threat model:

- **Shell agent sandboxing.** Once you opt in past the community-shell gate, the agent runs as the invoking user with full ambient authority: filesystem, network, processes. A malicious shell agent can `rm -rf $HOME`, exfiltrate `~/.ssh`, read browser cookies, or run any other command the user could run. The env filter reduces secret-leak blast radius but does not create a sandbox. Treat every `--allow-untrusted-shell` invocation like running the shell script yourself — because you effectively are. Real sandboxing (`nsjail` on Linux, `sandbox-exec` on macOS) is on the long-term roadmap.
- **Secrets-store encryption.** The AES-256-GCM cipher in `data/secrets.enc` uses a key derived from `scrypt(hostname + username)`. If the file ever leaves the machine — iCloud sync, Time Machine to a network share, accidental commit — an attacker who can guess the hostname and username (trivial for a targeted attacker) can decrypt the whole store. Today's encryption is **obfuscation, not a real defense**. The file's POSIX `0600` permission is the actual at-rest protection. Passphrase-based key derivation lands in v0.7.0; until then, treat the encrypted store as plaintext for threat-modeling purposes.
- **Prompt injection from claude-code upstream agents.** We only wrap values from `community` agents. If you write a `local` claude-code agent that can be manipulated by a user into producing prompt-injection payloads, and a second `local` agent reads its output, that output flows through unwrapped. Don't chain agents whose inputs you don't control.
- **Run output secrets (by default).** Agent stdout lands verbatim in `data/runs.db` unless the agent opts into `redactSecrets: true` (v0.6.0). The default behavior is still "store what the agent printed." If an agent you author calls a third-party API that might return a token, set `redactSecrets: true` to catch the AWS / GitHub / LLM / Slack prefixes. Do not rely on the scrubber for unknown secret formats — it's narrow on purpose. As of v0.6.0, `runs.db` is chmod 0o600 at create and rows older than 30 days are swept on startup; neither of those replaces redaction for live secrets.
- **Temporal workflow history.** When running under the Temporal provider, agent inputs and outputs are persisted in Temporal's own history store. That is a second plaintext sink outside sua's control. Same advice: don't echo secrets.
- **Remote MCP access.** MCP is localhost-only by design. If you need remote access, stand up a reverse proxy with its own auth in front of `--host 127.0.0.1` and understand that you are now maintaining that remote surface.
- **Denial of service.** sua does not rate-limit anything. An attacker with the bearer token (i.e., a local user) can hammer `run-agent` until disk or CPU runs out. The local-first threat model considers this a non-goal.

## Operator responsibilities

You are on the hook for:

1. **Guard the bearer token.** Anyone with `~/.sua/mcp-token` can invoke every `mcp: true` agent. Rotate with `sua mcp rotate-token` if you suspect compromise and update every MCP client config.
2. **Audit community agents before installing.** Run `sua agent audit <name>` to print the resolved YAML, read the `command:`, `prompt:`, and `envAllowlist:` fields, then opt in with `--allow-untrusted-shell <name>` per invocation. Prefer `type: claude-code` over `type: shell` when possible.
3. **Run `sua doctor --security` periodically.** Checks file perms on the MCP token / secrets / run store, flags any community shell agents that would refuse to run, reports which agents are MCP-exposed.
4. **Keep sua up to date.** Security fixes ship in minor versions in the 0.x range. `npm outdated -g @some-useful-agents/cli`.
5. **Lock down the repo.** Enable "Require review from Code Owners" on your `main` branch ruleset if you are running a multi-contributor fork. `.github/CODEOWNERS` is inert until you do.
6. **Keep secrets out of agent output.** Don't `echo $SECRET`. Set `redactSecrets: true` on agents that call third-party APIs whose responses might contain tokens.

## Reporting vulnerabilities

Do not open a public GitHub issue for a security report.

- Preferred: [GitHub Security Advisories](https://github.com/gregmeyer/some-useful-agents/security/advisories/new). Private by default; the maintainer can coordinate a fix before disclosure.
- Alternative: email the maintainer via the email in `package.json` `author` or on [the repo's GitHub profile](https://github.com/gregmeyer).

We respond within a week. There is no bug bounty.

## Version history

- **v0.4.0** — MCP transport lockdown (loopback bind, bearer token, Host/Origin allowlists, session-to-token binding), cron frequency cap, CI action SHA-pinning, CODEOWNERS.
- **v0.5.0** — Chain trust propagation (wrap community values, block community→shell), `mcp: true` agent opt-in, this document.
- **v0.6.0** — Community shell agent gate (`UntrustedCommunityShellError` + `--allow-untrusted-shell`), run-store `chmod 0600`, 30-day retention sweep, opt-in known-prefix secret redaction, `sua agent audit`, `sua doctor --security`.
- **v0.6.1** — Community agents are runnable from `sua agent run` / `sua schedule start` directly; the shell gate enforces per-invocation opt-in. Previously the gate lived in the executor but was unreachable from the CLI because community agents weren't in the runnable load set.
- **v0.7.0 (planned)** — Passphrase-based KEK for the secrets store, replacing today's hostname-derived obfuscation.
