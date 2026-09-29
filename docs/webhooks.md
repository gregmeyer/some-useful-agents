# Webhooks: start an agent from another service

Any agent can take a webhook: another service (GitHub, Stripe, Zapier, IFTTT, a cron job on another machine, a script) POSTs to it and the agent runs with inputs taken from the request.

## Turn it on

- **Dashboard:** the agent's **Config** tab → **Webhook** → **Turn on webhook**. It shows the URL, the secret, a `curl` example and the last delivery, with **Rotate secret** and **Turn off**.
- **Terminal:** `sua agent webhook <agent> --on` (also `--off`, `--rotate`; no flag shows the current state).

Webhooks are off until you turn them on, one agent at a time. Turning one on creates a secret for that agent.

## Call it

```bash
curl -X POST http://127.0.0.1:3000/hooks/issue-triage \
  -H "Authorization: Bearer whk_…" \
  -H "Content-Type: application/json" \
  -d '{"TITLE": "Crash on save", "BODY": "Steps: …"}'
# → 202 {"ok": true, "runId": "…"}
```

The secret can also go in `X-Sua-Token` or `?token=` (for services that can only set a URL). The run appears in Runs with **Triggered by: webhook**.

By default, top-level JSON fields fill the agent's **declared inputs of the same name**; anything else is ignored. A missing required input answers 400 and says which.

## Map a service's payload

Most services send their own shape. Map it with `webhook:` in the agent's YAML:

```yaml
id: issue-triage
inputs:
  TITLE: { type: string, required: true }
  BODY:  { type: string }
  EVENT: { type: string }
webhook:
  inputs:
    TITLE: $.issue.title          # a JSON path into the body
    BODY:  $.issue.body
    EVENT: header:X-GitHub-Event  # a request header (also query:name)
  when:
    $.action: opened              # only run for these deliveries; others get 202 {"ignored": true}
  signature: github               # verify GitHub's X-Hub-Signature-256 instead of a token
nodes:
  - id: triage
    type: goal
    goal: "Label and summarise this new issue: {{inputs.TITLE}} — {{inputs.BODY}}"
    tools: [http-get]
```

- Paths: `$.a.b`, `$.list[0].name`, `$["odd key"]`, and `$` for the whole body as JSON text.
- A value that isn't a string (a number, an object) is passed as JSON.
- Each input can be at most 32 KB; map a part of a large payload rather than all of it.

**GitHub:** Settings → Webhooks → Add webhook. Payload URL is your tunnel URL + `/hooks/<agent>`, content type `application/json`, and the secret is the agent's webhook secret. With `signature: github`, sua checks every delivery's signature and ignores tokens. GitHub's initial `ping` gets a 200 without running the agent.

## Reaching it from the internet

The dashboard listens on this machine only. A service on the internet needs a tunnel to it, for example:

```bash
cloudflared tunnel --url http://127.0.0.1:3000
# or: ngrok http 3000
```

Only `/hooks/*` works through the tunnel. Every other dashboard path still requires a request addressed to this machine (`127.0.0.1`/`localhost`) and your session, so the tunnel doesn't expose the dashboard.

## Responses

| Status | Meaning |
|---|---|
| 202 `{runId}` | Accepted; the run started |
| 202 `{ignored: true, reason}` | Didn't match `when:`; nothing ran |
| 200 `{pong: true}` | GitHub ping |
| 400 | Missing required input, or a mapping names an undeclared input |
| 401 | Missing or wrong secret / signature |
| 404 | No such agent, or its webhook is off (same answer for both) |
| 409 | The agent is paused / archived |
| 413 | Body over 1 MB, or an input over 32 KB |
| 429 | More than 30 deliveries for this agent in a minute |

## Safety

The secret is the only credential: anyone who has it can run the agent with inputs they choose. Rotate it if it leaks. Be careful exposing agents whose shell nodes use inputs unquoted. Community agents with shell nodes are refused. Webhook runs are bound by the agent's [spend limits](cost.md#limits) and the [tool policy](tool-policies.md) like any other run. More in [SECURITY.md](SECURITY.md#inbound-webhooks).

Design notes: [ADR-0043](adr/0043-inbound-webhooks.md).
