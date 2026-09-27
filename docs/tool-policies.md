# Tool policies

Decide which tools your agents may call, and on what. A policy is a small JSON file of
allow/deny rules that sua checks before **every** sua tool call:

- a tool node in a flow (`tool: http-get`, `type: file-write`, …), and
- every tool a model calls during an `llm-prompt` node, whichever provider answers:
  an OpenAI-compatible model through sua's tool loop, or claude through sua's tool
  endpoint ([ADR-0036](adr/0036-serve-sua-tools-to-claude-over-mcp.md)).

No file means no restrictions: everything is allowed, as before.

## Where it lives

`<dataDir>/.sua/policies.json` (with the default config, `data/.sua/policies.json`).
Every process that runs agents reads it: the dashboard, `sua agent run`, the scheduler,
the MCP server, and the Temporal worker. Edits apply to the next tool call; no restart.

## Rule shape

```json
{
  "version": 1,
  "defaultAction": "allow",
  "rules": [
    { "tool": "http-post", "effect": "deny",
      "conditions": { "source": ["community"] },
      "reason": "Community agents may not send data out." },

    { "tool": "file-write", "effect": "deny", "reason": "Writes only under out/." },
    { "tool": "file-write", "resources": ["/Users/me/project/out/*"], "effect": "allow" },

    { "tool": "shell-exec", "resources": ["rm *", "*sudo*"], "effect": "deny" }
  ]
}
```

| Field | Meaning |
|---|---|
| `tool` | Tool id to match. `*` matches every tool; globs work (`csv.*`, `notion-*`). |
| `resources` | Globs matched against what the call touches (below). Empty or absent ⇒ any resource. |
| `effect` | `allow` or `deny`. |
| `conditions.source` | Only for agents from these tiers: `examples`, `local`, `community`. |
| `reason` | Shown to you (run page, `sua policy check`) and to the model when it's blocked. |
| `defaultAction` | What happens when no rule matches. `allow` (default) or `deny`. |

**The last matching rule decides.** Put broad rules first and exceptions after, like the
`file-write` pair above: deny all writes, then allow the one folder.

### What a rule's `resources` is matched against

The value the tool will really receive, after templates like `{{inputs.URL}}` are filled in:

| Tools | Resource |
|---|---|
| `http-get`, `http-post`, `web-fetch`, `web-scrape` | the URL (`url` or `endpoint`) |
| `file-read`, `file-write` | the **absolute** path, resolved against the node's working directory |
| `shell-exec` | the command |
| anything else (integration, MCP tools, …) | nothing: only a `resources` of `*` (or no `resources`) matches |

Globs: `*` matches any run of characters **including `/`**, `?` matches one character,
everything else is literal and case-sensitive. So `https://api.github.com/*` matches any
path on that host (but not `https://api.github.com.evil.example/…`). For files, write
absolute patterns (`/Users/me/project/out/*`) or `*/out/*`.

## When a call is blocked

- **Tool node:** the node fails with category **Blocked by tool policy** and the rule's
  reason. It is not retried: a policy decision doesn't change on a second try.
- **A model's tool call:** the model gets `Blocked by policy: <reason>` as the tool's
  result and can carry on without it (or explain what it couldn't do). The call appears in
  the node's **tool calls** list on the run page, marked as an error.

## A broken file blocks everything

If `policies.json` exists but isn't valid (bad JSON, a misspelled field), sua **fails
closed**: every tool call is denied with the file's error as the reason, until you fix it.
A typo in a deny rule never quietly turns into "allow everything".

## `sua policy`

```sh
sua policy show                                   # what's in force, numbered
sua policy check web-fetch https://example.com/x  # allow/deny, which rule, why
sua policy check http-post https://x --source community
sua policy validate                               # non-zero exit if the file is invalid
```

`check` exits 0 for allow and 1 for deny, so it works in scripts.

## What policies don't cover

- **Plain `shell` nodes** (`type: shell` with a `command:`), which run a command
  directly rather than through a tool. The community-shell gate
  (`--allow-untrusted-shell`) still governs those for community agents.
- **A CLI provider's own built-in tools**, such as claude's Bash or WebFetch. Those are
  controlled by the node's `allowedTools`; sua doesn't grant them otherwise.

Policies are a guardrail on what agents may *ask* sua to do, not a sandbox: see
[SECURITY.md](SECURITY.md).
