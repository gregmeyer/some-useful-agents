# CLAUDE.md

## Docs map
- **User-facing docs**: [docs/](docs/) — quickstart, agents, flows, tools, mcp, output-widgets, templating, dashboard, security
- **Architecture decisions**: [docs/adr/](docs/adr/) — MADR-lite records for load-bearing choices
- **Changelog**: [CHANGELOG.md](CHANGELOG.md) (produced by `changeset version` at release time)
- **Roadmap**: [ROADMAP.md](ROADMAP.md)

When adding or changing a feature, update the matching doc in `docs/` and add an ADR if the decision is non-obvious. Prefer updating existing docs over creating new ones.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.
