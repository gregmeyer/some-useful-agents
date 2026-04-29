# CLAUDE.md

## Docs map
- **User-facing docs**: [docs/](docs/) — quickstart, agents, flows, tools, mcp, output-widgets, templating, dashboard, security
- **Architecture decisions**: [docs/adr/](docs/adr/) — MADR-lite records for load-bearing choices
- **Changelog**: [CHANGELOG.md](CHANGELOG.md) (produced by `changeset version` at release time)
- **Roadmap**: [ROADMAP.md](ROADMAP.md)

When adding or changing a feature, update the matching doc in `docs/` and add an ADR if the decision is non-obvious. Prefer updating existing docs over creating new ones.

## Changesets — required on every code PR

Every PR that touches `packages/*` source code MUST include a changeset under `.changeset/<name>.md` **in the same PR**. No exceptions for "small" patches — the bot can't open a release PR without one. See [CONTRIBUTING.md § Changesets](CONTRIBUTING.md#changesets) for human-contributor docs.

**Format** (file frontmatter + body):

```markdown
---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

One-line title.

Body paragraph(s) explaining what changed and why a user would care.
```

**Rules:**
- List **all five workspace packages** in the frontmatter — the workspace is in a fixed group, so they bump together. Listing fewer can confuse the bot.
- Bump level: `patch` for fixes, `minor` for new schema fields / new CLI verbs / new config knobs, `major` only with explicit user approval (we're pre-1.0; default to minor for new features).
- File name: short kebab-case describing the change (e.g. `daemon-supervisor.md`, `runs-pagination-fix.md`). Don't reuse names from already-released changesets.
- Don't backfill changesets for already-released PRs — that creates phantom version bumps. Only stage changesets for unreleased work.

**Skip the changeset only when:**
- The PR is doc-only (`README.md`, `docs/**`, `ROADMAP.md`, `CLAUDE.md`, `.changeset/README.md`).
- The PR touches only `agents/`, `.gitignore`, `.claude/`, or other non-published paths.
- The PR is itself a `chore: add changesets` PR (the changesets ARE the changeset).

If unsure, add one — a no-op `patch` changeset is cheaper than a missed release entry.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.
