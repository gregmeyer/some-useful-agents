# experiment-read

Read what an [experiment](../experiments.md) found. An experiment gives one agent the same ask under different versions of it, runs the whole agent a few times under each, and counts how much what they produced has in common. The readout has:
- what it set out to find, and how it stands (how many of its runs are in);
- **what it found**, in a sentence, with what that rests on and the figures behind it;
- how it is set up: the agent it runs, how many times each, what it is asked, each change with its versions, and how results are scored;
- each version against the baseline, with every score, and each change by itself;
- what each version found: every item any run listed, with how many of each version's runs listed it and where;
- its runs: how many were usable, and why any weren't.

Every number is counted from the experiment's stored runs, the same ones its page shows. A reader should repeat them as given: the readout says so, and says the finding holds for that ask only.

It only reads; it never runs or changes an experiment. Archived ones can be read too. It's built in; add it to a node's `tools:`.

```yaml
nodes:
  - id: think
    type: llm-prompt
    tools: [experiment-read]
    prompt: |
      Read the experiment "old-or-new-job-finder". Say which version of the
      agent you would keep and why, quoting its finding and what it rests on.
      Do not claim more than the experiment found.
```

MCP clients (Claude Desktop, Codex…) get the same tool from `sua mcp`.

In a conversation with sua you don't need the tool: sua is told your ten newest experiments and what each found, and reads one in full when the thread links it (`/experiments/<id>`) or you name it.

| Input | Type | Required | Description |
|---|---|---|---|
| `experiment` | string | no | The experiment: its id, a `/experiments/<id>` link (a full address works), or words from its name. Leave it empty to list every experiment, archived ones included, each with how it stands and its question. |
| `part` | string | no | Read one part only: `all` (the default), `finding`, `setup`, `conditions`, `items`, or `runs`. |
| `format` | string | no | `text` (the default; Markdown for a model to read) or `json` (for code; the same content in the `experiment` output). |

If the words match more than one experiment, it lists those (id, name, how it stands, archived) so you can read one by its id. If nothing matches, it says so. An experiment that hasn't run says it has found nothing.

The text readout shows up to 40 items; JSON has them all. Links in the readout are dashboard paths (`/experiments/<id>`, `/notebooks/<id>`).

**Tool policy.** The [resource](../tool-policies.md) is the experiment's id when you give an id or a link, and otherwise the words you asked with. To keep one experiment private from agents and MCP clients, deny `experiment-read` for its id. A deny on an id doesn't catch a lookup by name, so if you need it to, add a resource pattern for its name as well.
