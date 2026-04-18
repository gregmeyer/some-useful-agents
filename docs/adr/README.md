# Architecture Decision Records

This directory captures the **why** behind architectural choices in
`some-useful-agents`. Code tells you what. ADRs tell you why.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-monorepo-with-npm-workspaces.md) | Monorepo with npm workspaces | Accepted |
| [0002](0002-sqlite-via-node-builtin.md) | SQLite via `node:sqlite` built-in | Accepted |
| [0003](0003-mcp-http-sse-transport.md) | MCP via HTTP/SSE streamable transport | Accepted |
| [0004](0004-temporal-worker-on-host.md) | Temporal worker runs on host, not Docker | Accepted |
| [0005](0005-shell-sandbox-claude-on-host.md) | Shell agents sandboxed in Docker; claude-code agents on host | Accepted |
| [0006](0006-env-filtering-by-trust-level.md) | Env filtering by trust level | Accepted |
| [0007](0007-encrypted-file-secrets-store.md) | Encrypted file secrets store with machine-bound key | Accepted |
| [0008](0008-npm-trusted-publishing.md) | npm Trusted Publishing via OIDC | Accepted |
| [0009](0009-changesets-for-versioning.md) | Changesets for version management | Accepted |
| [0010](0010-environment-gated-release.md) | Environment-gated release workflow | Accepted |
| [0011](0011-slack-webhooks-not-oauth.md) | Slack via incoming webhooks, not OAuth | Proposed |
| [0012](0012-local-cron-scheduler-node-cron.md) | Local cron scheduler via node-cron | Accepted |
| [0013](0013-tutorial-and-dad-joke-example.md) | Onboarding tutorial + dad-joke example | Accepted |
| [0014](0014-passphrase-kek-secrets-store.md) | Passphrase KEK for secrets store | Accepted |
| [0015](0015-global-variables-store.md) | Global variables store (plain-text, non-sensitive) | Accepted |
| [0016](0016-llm-spawner-abstraction.md) | LlmSpawner abstraction for multi-provider CLI support | Accepted |
| [0017](0017-agent-analyzer-self-correcting.md) | Agent analyzer as a self-correcting agent pipeline | Accepted |
| [0018](0018-three-layer-secret-redaction.md) | Three-layer secret redaction in run logs | Accepted |

## Template

Use the [MADR-lite](https://adr.github.io/madr/) format. Keep each ADR to one
page. The goal is captured judgment, not exhaustive prose.

```markdown
# ADR-NNNN: Title

## Status
Accepted | Proposed | Superseded by ADR-XXXX

## Context
What's the problem? What forced this decision?

## Decision
What did we choose and why?

## Consequences
What trade-offs are we accepting? What becomes easier? What becomes harder?
```

## When to write an ADR

- Any decision that shapes the codebase for 6+ months
- Any decision you'd have to re-explain to a new contributor
- Any decision that rejects an obvious alternative (the "why not X" matters)

## When NOT to write an ADR

- Small refactors, bug fixes, dependency bumps
- Decisions that are fully captured in commit messages or PR bodies
- Style and formatting choices (those live in linter config)

## Changing a decision

Don't edit old ADRs. Write a new one that supersedes the old one, and mark
the old one's status as `Superseded by ADR-NNNN`. Decisions are historical
artifacts.
