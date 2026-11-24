# 0103. A shared tool and the agents that call it, on one card

- Status: accepted
- Date: 2026-11-24

## Context

Several agents often do the same job each in their own way: five fetched the same story API, nine called three job-board APIs. A tool (ADR-0102) can do that job once, but pointing the agents at it meant a new tool plus an edit to each agent — and the inbox could change one agent per card (`agent-editor`), or two (`agent-compose`). Done as separate cards, some could be approved and others not, leaving a tool nothing used or agents calling a tool that wasn't saved.

## Decision

- **sua proposes `tool-refactor` from a conversation** ("point my job-board agents at a shared tool"), naming the agents (two to eight). It's read-only and runs without asking: the `tool-refactorer` agent drafts one tool for what their command steps do (or names one of yours that already does it), and the `agent-retooler` rewrites each agent to call it. The tool is checked as `sua tool add` would; each agent's change is checked as the card will check it, with one more try told what was wrong. Agents whose change doesn't check out, or that don't do the job, are left out with why.
- **It ends in ONE `tool-refactor-apply` card**: the tool, each agent's change in words and as a diff, what was left out. Approving checks everything first, then saves the tool and each agent as a new version; if any save fails, the ones before it are undone. Never auto-approved.
- **An agent's change on the card must keep what it gives back** (its declared outputs), use the tool, use only tools that exist (or this one), and start from the version it was made from.
- **The agent-editor card's checks are shared** (`lib/agent-edit.ts`) so both cards judge an edit the same way; the editor card doesn't add the tool check.
- **The fixer sees their tools**: the discovery catalog the analyzer and builder read lists the operator's tools, so a one-agent fix can call one too.

## Consequences

- Rolling back is per agent (Versions); the tool stays until removed (tools have no versions yet).
- The rewrite keeps outputs by key, not by value; a reshaping step the retooler adds is reviewed on the card's diff, and the first runs after are the real check.
