# ADR-0001: Monorepo with npm workspaces

## Status
Accepted

## Context

A greenfield TypeScript project needed a code layout. Two realistic choices:

- **Single package** — one `src/` directory, one `package.json`, ship as one
  npm package. Fastest to start, but refactoring into multiple packages later
  means changing every import and test.
- **Monorepo** — multiple `packages/*` each with their own `package.json` and
  `tsconfig.json`, npm workspaces tying them together. More build config up
  front. Each package publishable to npm independently.

Because this project is **community-first** (MIT, public repo, people expected
to build on top of individual pieces), external consumers wanting only the
types or only the MCP server matters. Bundling the whole thing into a single
package forces people to install Temporal just to use the YAML schema.

A brief diversion into Turborepo was considered and rejected — for 4-5
packages, workspace tooling from npm directly is sufficient and has zero extra
dependencies.

## Decision

Monorepo with npm workspaces. Five packages:

- `@some-useful-agents/core` — types, schemas, agent loader, run store,
  LocalProvider, env builder, secrets store, scheduler, LLM invoker
- `@some-useful-agents/cli` — the `sua` binary
- `@some-useful-agents/mcp-server` — MCP server (HTTP/SSE)
- `@some-useful-agents/temporal-provider` — Temporal workflows + worker
- `@some-useful-agents/dashboard` — future web UI

All packages ship independently. Versions track together via changesets
fixed-versioning while the project is v0.x.

## Consequences

**Easier:**
- Consumers can `npm install @some-useful-agents/core` and build on the types
  without pulling in Temporal or the CLI.
- Build cache invalidation works per-package.
- The mental separation of concerns is enforced by TypeScript project
  references — CLI literally cannot depend on internal details of
  mcp-server unless exported.

**Harder:**
- Every package has its own `package.json` and `tsconfig.json` to maintain.
- Internal dependencies use `"@some-useful-agents/core": "*"` which npm
  workspaces resolves to the local package during dev.
- Changesets must be configured to fixed-bump all packages together (see
  ADR-0009) or contributors have to remember which packages their change
  affects.

**Trade-offs accepted:**
- The initial commit is ~30 files of config boilerplate before any real logic.
  With LLM-assisted tooling, this cost is measured in minutes, not days.
