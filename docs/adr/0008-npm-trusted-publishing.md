# ADR-0008: npm Trusted Publishing via OIDC

## Status
Accepted

## Context

Publishing packages to npm from CI traditionally requires a long-lived
`NPM_TOKEN`. That token sits in a GitHub Actions secret, is used on every
publish, and has broad scope (anything the token owner can publish).

Known failure modes:

- **Token leaks** via mistyped workflow, logs, or malicious contributor
  injecting a step that echoes it.
- **Rotation fatigue** — nobody rotates their npm tokens quarterly.
- **Scope overreach** — automation tokens often have `read and write` to
  the entire account, not just the target org.

npm shipped **Trusted Publishing (OIDC)** in July 2025. CI exchanges a
short-lived OIDC token with npm directly. No secret is stored. The token
is cryptographically bound to:

- The specific GitHub repository
- The specific workflow file
- The specific GitHub Environment

## Decision

Use Trusted Publishing. Configure each published package at
`npmjs.com/package/<name>/access` with:

- Publisher: GitHub Actions
- Organization: `gregmeyer`
- Repository: `some-useful-agents`
- Workflow filename: `release.yml`
- Environment: `npm-publish`

Remove `NPM_TOKEN` from GitHub Secrets entirely. Workflow uses
`permissions: id-token: write` for OIDC.

Provenance attestations are published automatically (no `--provenance` flag
needed) so consumers can verify each package came from this repo + workflow.

## Consequences

**Easier:**
- No token to rotate, leak, or manage.
- Each publish's provenance is verifiable by anyone: `npm view <pkg> attestations`.
- Supply-chain compromise requires breaking into GitHub Actions' OIDC
  provider, not stealing a secret.

**Harder:**
- One-time bootstrap: each package must be manually published once (with
  user credentials) so it exists in the registry before Trusted Publisher
  can be configured for it.
- Provenance verification checks that `package.json`'s `repository.url`
  matches the OIDC claim's repo — caught this the hard way when our first
  release failed because `repository.url` wasn't set per-package (fixed in
  PR #11).
- Requires npm CLI >= 11.5.1, which means the release workflow runs on
  Node 24 (ships with npm 11) rather than our default Node 22.

**Trade-offs accepted:**
- Bootstrap friction for a one-time setup. Future repos can follow the
  pattern documented in CONTRIBUTING.md.
