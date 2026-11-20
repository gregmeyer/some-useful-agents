# ADR-0085: The sua catalog as an A2UI 1.0 catalog document

- Status: accepted
- Date: 2026-11-20
- Deciders: Greg Meyer

## Context

In A2UI 1.0 a catalog is a document: JSON with `catalogId`, `protocolVersion`, `title`, `description`, `instructions`, `components` and `functions`. Renderers and agents exchange catalog ids to agree on what can be drawn, and tools can read the document.

sua's catalog lived only in code, as zod schemas in `core/src/a2ui/catalog.ts`. Its `catalogId` named a URL that served nothing.

A2UI's own serialiser (`Catalog.toJson`) writes the basic components and functions correctly. Components defined in plain zod rather than A2UI's specification style, which is how all of sua's are written, come out as empty stubs.

## Decision

**`suaCatalogDocument()` (core) writes the sua catalog as a 1.0 catalog document.**

- The basic components and functions come from `Catalog.toJson`, as A2UI publishes them.
- Each sua component is generated from its zod schema with `zod-to-json-schema`, exported from the vendored web_core so core adds no dependency:
  - A2UI's `REF:` markers become `$ref`s to `common_types.json`;
  - the generic "Represents a string" notes are dropped;
  - the reserved `@` keys are left to the common types;
  - the entry carries its one-line summary as `description` (board-only components say so) and its example as `examples`.
- `instructions` says how to bind (`{"@path"}`), what makes an id, and to prefer sua's components for what they are for.
- The dashboard serves it at `/a2ui/catalogs/sua/v1.json`.
- A test reads it back with A2UI's own loader (`Catalog.fromJson`), validates a surface against the loaded copy, and checks that an unknown prop is refused. So the document is a real, usable 1.0 catalog, not only a description.

## Consequences

- The document is about 60 KB. A tool, an MCP host or another agent can learn the catalog from it, which is what capability negotiation needs (plan PR 6).
- The model guides still read the same `SUA_COMPONENTS` list the document is built from, so the two can't disagree. Moving the guides to read the document itself buys nothing yet.
- Not done: linting with A2UI's Dart CLI and running its conformance suite in CI. The `fromJson` round-trip covers the same ground for our use, without a Dart toolchain.
