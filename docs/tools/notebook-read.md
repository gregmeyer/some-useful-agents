# notebook-read

Read what a [notebook](../notebooks.md) knows:
- what it's for, its limits, checks and done-whens;
- the facts it learned about who it's about, each with its source, plus their competitors, other companies and anything not yet settled;
- the answer, talking points or plan it wrote (leaving out anything you struck);
- its options, best first, with their facts, sources and check results; the ones ruled out, with why; and the pick;
- its notes and evidence, newest first.

It only reads, and archived notebooks can be read too. It's built in; add it to a node's `tools:`.

```yaml
nodes:
  - id: think
    type: llm-prompt
    tools: [notebook-read]
    prompt: |
      Read the notebook "brief-northwind-example". From what it knows about the
      company, its competitors and its investors, say what adding Acme Ventures as an
      investor would change. Say which parts rest on the notebook's sources.
```

MCP clients (Claude Desktop, Codex…) get the same tool from `sua mcp`, so another app can use a notebook's research too.

| Input | Type | Required | Description |
|---|---|---|---|
| `notebook` | string | no | The notebook: its id, a `/notebooks/<id>` link (a full address works), or words from its title. Leave it empty to list every notebook, archived ones included. |
| `part` | string | no | Read one part only: `all` (the default), `about`, `written` (the answer, talking points and plan), `options`, or `notes`. |
| `format` | string | no | `text` (the default; Markdown for a model to read) or `json` (for code; the same content in the `notebook` output). |

If the words match more than one notebook, it lists those notebooks (id, title, status, archived) so you can read one by its id. If nothing matches, it says so.

It shows up to 40 options in the running, 20 ruled out and 20 notes, and says how many more there are. Links in the readout are dashboard paths (`/notebooks/<id>`).

**Tool policy.** The [resource](../tool-policies.md) is the notebook's id when you give an id or a link, and otherwise the words you asked with. To keep one notebook private from agents and MCP clients, deny `notebook-read` for its id. A deny on an id doesn't catch a lookup by name, so if you need it to, add a resource pattern for its name as well.
