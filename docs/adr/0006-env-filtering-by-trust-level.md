# ADR-0006: Env filtering by trust level

## Status
Accepted

## Context

The original agent executor did this:

```typescript
const env = { ...process.env, ...(agent.env ?? {}) };
```

Every spawned agent inherited the full `process.env`. This meant a community
agent from `agents/community/` — potentially written by a stranger — got
access to `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`,
`DATABASE_URL`, and anything else the user had in their shell.

Classic supply-chain risk: malicious agent prints or POSTs out whatever
secrets the shell session has.

The fix needed to be non-invasive for local agents (which the user wrote
and expects to work) while tight for community agents (which the user may
not have inspected).

## Decision

Build a per-agent env from a filtered subset of `process.env`, based on a
**trust level** derived from the agent's source directory:

| Source | Trust | Inherits |
|--------|-------|----------|
| `agents/examples/` or `agents/local/` | `local` | `PATH`, `HOME`, `USER`, `SHELL`, `LANG`, `LC_*`, `TERM`, `TMPDIR`, `NODE_ENV`, `TZ` + agent's `envAllowlist` |
| `agents/community/` | `community` | `PATH`, `HOME`, `LANG`, `TERM`, `TMPDIR` + agent's `envAllowlist` |

Secrets the agent declares via `secrets: [FOO]` are resolved from the
encrypted store and injected after the filtered `process.env`. The agent's
own `env: { KEY: value }` YAML block is applied last as explicit overrides.

Warnings are emitted when an `env` value looks like a hardcoded secret
(key contains KEY/SECRET/TOKEN/PASSWORD/AUTH, value >= 20 chars) suggesting
the user move it to the secrets store instead.

## Consequences

**Easier:**
- Community agents literally cannot see `AWS_SECRET_ACCESS_KEY`, regardless
  of how careful the user is about their shell environment.
- Local agents work the way users expect because PATH, HOME, shell
  defaults, and language settings are all there.
- Adding a custom allowed env var is explicit: `envAllowlist: [MY_CUSTOM]`.

**Harder:**
- Users porting agents from elsewhere may hit "env var not set" in community
  agents and need to either declare it as a secret or add it to
  `envAllowlist`. Error message tells them both options.

**Trade-offs accepted:**
- The allowlist for `local` is permissive. Anyone who writes a local agent
  can exfiltrate their own secrets, but they authored the agent, so there's
  no trust boundary to protect.
