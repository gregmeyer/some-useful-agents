# ADR-0010: Environment-gated release workflow

## Status
Accepted

## Context

With Changesets (ADR-0009) and Trusted Publishing (ADR-0008) in place, a
question remained: **when does a publish actually happen?**

Default Changesets setup: merging a Release PR triggers an automatic publish.
For most projects that's fine. For a project where any merge to main can
trigger the publish step, it means:

- Any maintainer with merge rights can publish without a review moment
- A compromised maintainer account = silent publish
- Accidental merge of a stale Release PR = accidental publish

The original PR #7 had this flaw. When the user asked "is it a good idea to
allow anyone to publish?" — no, it wasn't.

GitHub Actions supports **Environments** with **required reviewers**. A job
running in an environment pauses until a reviewer clicks approve in the
Actions UI.

## Decision

The release workflow's `Version PR or Publish` job declares
`environment: npm-publish`. The `npm-publish` environment has required
reviewers (repo maintainers).

Concretely:

1. Merge to main (regular PR or Release PR)
2. Workflow starts, immediately pauses at the environment gate
3. Reviewer clicks **Review deployments → Approve**
4. Job runs — opens Release PR, or publishes to npm if this merge was a
   Release PR

## Consequences

**Easier:**
- Every publish requires an explicit "yes" from a human who looked at what
  was about to ship.
- The gate protects against both mistakes and hostile actors — even if
  someone's account is compromised, they can't publish without the 2FA +
  session on the approval click.
- Works cleanly with Trusted Publishing: the OIDC token's environment
  claim is `npm-publish`, bound at the npm side as a required publisher
  match.

**Harder:**
- One extra click per release. Annoying for rapid small releases; valuable
  for security.
- Bootstrap confusion: if the environment doesn't exist when the workflow
  first runs, GitHub auto-creates it with no reviewers, bypassing the gate.
  The fork-setup instructions explicitly say to create the environment
  before the first workflow run.

**Trade-offs accepted:**
- Release cadence is bounded by a human's attention. Fine for this
  project's scope. Fast-moving projects can widen the reviewer list.
