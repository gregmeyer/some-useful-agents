# notebook-create

Start a new [notebook](../notebooks.md) from an MCP client (Claude Desktop, Codex, another agent connected to `sua mcp`), the way New notebook would. It's offered over MCP only, not as an agent tool.

There are two ways to start one:

- **From a template.** Pass `template` and, when the template needs one, `subject`. This is the same as starting from one of your templates in the dashboard. `{subject}` is filled in everywhere, the template counts as used, and anything it asks you for becomes a box on the new notebook.
- **From an ask.** Pass `ask`. sua drafts the notebook from it, as when you type a sentence on New notebook, and starts it from the draft untouched. An ask to learn about one named thing ("Tell me about Acme, https://acme.example") becomes a briefing on it ([ADR-0080](../adr/0080-a-briefing-on-a-subject.md)), with the link as its site.

```json
{ "template": "company briefing", "subject": "Acme" }
{ "ask": "Tell me about Acme, https://acme.example", "start": true }
```

| Input | Type | Required | Description |
|---|---|---|---|
| `template` | string | one of `template` / `ask` | A template's id, or words from its name. `notebook-templates` lists them. |
| `subject` | string | when the template has one | Who or what it's about, for example a company or a person. It's capped at 80 characters. |
| `ask` | string | one of `template` / `ask` | What the notebook is for, in a sentence. |
| `title` | string | no | Its title. Otherwise it comes from the template or the draft. |
| `start` | boolean | no | Start its first step once it's made. It's off by default, so the notebook waits for you to press **Next step**. |

If neither `template` nor `ask` is given, or both are, the call fails straight away. It also fails at once for an unknown or archived template, or a missing subject.

**It's queued.** The MCP server records the request, and the dashboard claims it and makes the notebook within a few seconds; an ask takes about a minute while sua drafts it. The reply carries a request id. Pass that id to **`notebook-create-status`**, which reports one of these phases:
- `queued`
- `drafting`
- `creating`
- `ready`, with the notebook's id and `/notebooks/<id>` link and its steps
- `failed`, with why

Read the notebook with [`notebook-read`](notebook-read.md) once it's ready.

When `start` is true and the first step can't run yet, the notebook is still made, and the status says why the step didn't start. Two common reasons: a template is waiting for something only you can give (a profile as a PDF), or sua is still setting up its steps.

**The dashboard has to be running** for a request to be made. A request still being made when the dashboard restarts is marked failed. Each notebook started this way puts a low-priority note in your inbox.

**Tool policy.** Deny `notebook-create` in `.sua/policies.json` to stop MCP clients starting notebooks ([tool-policies.md](../tool-policies.md)).
