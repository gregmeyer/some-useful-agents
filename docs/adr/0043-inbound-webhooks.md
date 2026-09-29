# ADR-0043: Inbound webhooks on the dashboard server, per-agent secret, off by default

- Status: accepted
- Date: 2026-09-29
- Deciders: Greg Meyer

## Context

Agents started from a schedule, the dashboard, the CLI, MCP or a chat; nothing outside this
machine could start one when something happened (an issue opened, a payment failed, a form
submitted). The owner chose webhooks first.

The dashboard is the only long-running HTTP server. It binds to loopback and rejects any
request whose `Host` isn't loopback (DNS-rebinding defence), then requires a session cookie.
Services on the internet reach a local server through a tunnel, which sends the tunnel's
hostname.

## Decision

- **`POST /hooks/<agent>` on the dashboard**, mounted before the body parsers (a GitHub
  signature covers the raw bytes) and before the session and `Host` checks. It is the only path
  that works through a tunnel; everything else still needs loopback + a session.
- **Per agent, off by default.** Turning it on creates a random secret (`whk_` + 192 bits) in a
  `webhooks` table. A request presents it (bearer / `X-Sua-Token` / `?token=`), or, with
  `webhook.signature: github`, signs the body with it. Constant-time comparison. Unknown agent
  and "off" both answer 404.
- **Inputs:** top-level JSON fields fill declared inputs of the same name; the agent's optional
  `webhook.inputs` maps JSON paths / headers / query params; `webhook.when` filters deliveries
  (202 ignored). Only declared inputs are set.
- **Limits:** 1 MB body, 32 KB per input, 30 deliveries per agent per minute (in memory), paused
  and community-shell agents refused. Runs are `triggeredBy: 'webhook'` and go through the normal
  backend (Temporal or in process), spend limits and tool policy.

## Alternatives rejected

- **A separate listener/port for hooks.** One more port and daemon to run; the `Host` check
  already keeps the rest of the dashboard unreachable through a tunnel.
- **One global secret.** A leak would expose every agent; per-agent secrets are rotated
  independently.
- **Webhook config (and secret) in the YAML.** Secrets in agent files end up in exports, packs
  and git. The YAML holds only the mapping; the secret lives in the database.
- **Generic HMAC schemes for every provider now.** GitHub's is the common one; others can be
  added as `signature:` values.

## Consequences

- Exposing an agent means trusting whoever holds its secret with its inputs; the docs say so.
- The rate limit resets on restart and is per process.
- Other trigger kinds (email via Gmail, file watch) can reuse `mapWebhookInputs`-style mapping.
