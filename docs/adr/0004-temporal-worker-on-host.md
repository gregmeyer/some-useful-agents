# ADR-0004: Temporal worker runs on host, not Docker

## Status
Accepted

## Context

Temporal workflows execute via workers that pull tasks from the Temporal
server. Those workers run user code — for this project, the user code is
spawning `bash -c '<command>'` or `claude --print`.

Natural instinct: containerize everything. Put the Temporal server, the
worker, and the MCP server all in `docker-compose.yml`. Clean, reproducible,
one-command startup.

Problem: the worker needs to execute shell commands on the user's system.
If the worker runs in Docker, "shell agent" becomes "shell command inside
the container." That container doesn't have the user's dev tools, API
credentials, or home directory. For claude-code agents, it would need the
user's Claude CLI installation, API key, and subscription — which means
mounting `~/.claude` into the container, at which point the "sandbox" has
leaked the keys to the kingdom anyway.

## Decision

The Temporal **server** runs in Docker (via `docker-compose.yml`). The
Temporal **worker** runs on the host (`sua worker start`). The server is
pure infrastructure and benefits from Docker; the worker needs host access
and doesn't benefit.

## Consequences

**Easier:**
- Workers spawn shell commands with full access to the user's tools, PATH,
  and files. No volume mount gymnastics.
- `claude --print` works because the worker runs next to the user's Claude
  CLI install.
- Local development: edit code, restart worker with `sua worker start`. No
  rebuild-image cycle.

**Harder:**
- Users must run `sua worker start` in a separate terminal (or daemonize it)
  to use the Temporal provider. `sua agent run --provider temporal`
  without a worker hangs, so we added a 5-second pending-timeout warning
  that tells users exactly what's wrong.
- The deployment story is less "one-command-all-in-Docker" than users
  might expect. The README calls this out.

**Trade-offs accepted:**
- Host execution means the worker gets everything the invoking user has.
  This is by design: trust boundaries are enforced at the agent definition
  layer (see ADR-0005 and ADR-0006), not at the worker layer.
