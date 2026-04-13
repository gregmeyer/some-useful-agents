# ADR-0009: Changesets for version management

## Status
Accepted

## Context

A monorepo with 5 packages needs a story for:

- Deciding what's in a release
- Generating a CHANGELOG
- Bumping versions
- Coordinating package versions (do they track together or independently?)

Options considered:

1. **Manual** — maintainer edits each `package.json` and `CHANGELOG.md` by
   hand. Doesn't scale past one maintainer.
2. **Semantic-release** — commit-message-driven. Every merge to main
   potentially triggers a release. Hard to batch multiple PRs into one
   version bump.
3. **Changesets** — contributors describe changes in `.changeset/*.md`
   files alongside their PR. A bot opens a "Release PR" aggregating pending
   changesets. Merging the Release PR cuts the version.

Changesets is the de-facto standard in the JS ecosystem for monorepos
(Turborepo, shadcn/ui, Radix UI all use it).

## Decision

Adopt Changesets with **fixed versioning**: all 5 `@some-useful-agents/*`
packages bump to the same version together. Configured via the `fixed` key
in `.changeset/config.json`.

CI workflow runs Changesets on every push to main:

- If pending changesets exist: open/update a Release PR with version bumps
  + generated CHANGELOG
- If a Release PR's version bumps have been merged: publish to npm

## Consequences

**Easier:**
- Contributors write `.changeset/my-feature.md` describing their change in
  plain English. The bot does the CHANGELOG mechanics.
- Batched releases: multiple PRs accumulate in one Release PR, making each
  version cut a reviewable diff.
- CHANGELOG quality: forced to write user-facing descriptions instead of
  machine-formatted commit messages.

**Harder:**
- Fixed versioning means a patch to one package bumps all five to the same
  version number. Could be wasteful when only one package changed. Fine
  while the project is v0.x and all packages share a release cadence; we'll
  revisit when packages mature at different rates.
- Contributors need to remember to run `npx changeset` as part of their PR.
  CONTRIBUTING.md documents this. CI does not enforce it yet; a future
  improvement is a GitHub Action that fails if a source file changed but
  no changeset is present.

**Trade-offs accepted:**
- Slight contributor overhead for much better release hygiene.
