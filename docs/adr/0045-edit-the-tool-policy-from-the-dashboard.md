# ADR-0045: Edit the tool policy from the dashboard, safely

- Status: accepted
- Date: 2026-10-01
- Deciders: Greg Meyer

## Context

The tool policy lives in `<dataDir>/.sua/policies.json` and is enforced on every tool call.
Phase U4 showed it read-only in Settings → Policies; editing meant opening the file. A broken
file fails closed (every tool call blocked), so a careless writer could take the whole
project down, and the file is also edited by hand, so a dashboard save could silently overwrite
a terminal edit.

## Decision

The dashboard edits the file through one core writer (`savePolicyDocument` /
`savePolicyText` in `policy-store.ts`) with three guarantees:

1. **Never write an invalid document.** The document (or raw JSON text) is validated
   against `policyDocumentSchema` before anything touches disk. The structured editor can't
   produce a file that blocks everything; the JSON editor refuses one.
2. **Never overwrite an edit you didn't see.** Every form carries a version (a hash of the file
   as rendered). A save whose version no longer matches the file is refused with
   `PolicyConflictError` ("reload and try again"). No merging: the file is small and the
   person can redo one change.
3. **One-step undo.** The previous contents are kept as `policies.json.bak`; Undo swaps them
   back (so Undo twice is redo). Writes are atomic (temp file + rename) and invalidate the
   resolver's cache, so the change applies on the next tool call.

Structured saves are written in a canonical form (defaults omitted); the JSON editor keeps the
author's text as typed. Editing rules is refused while the file is invalid: the JSON editor
(open by default then) or Undo is the way out.

## Consequences

- No new trust boundary: the dashboard is already authenticated and can edit agents, secrets
  and settings. Agents can't reach these routes (session cookie + loopback/origin checks).
- A structured save reformats a hand-formatted file and drops unknown keys (the schema strips
  them). Comments aren't possible in JSON anyway.
- One level of undo only; git or a backup is the history.
- A `sua policy add/remove` CLI can reuse the same writer later.
