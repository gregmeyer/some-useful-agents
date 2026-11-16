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
| `subject` | string | when the template has one | Who or what it's about, for example a company or a person. It's capped at 80 characters. A website given with it ("Duolingo, duolingo.com") is taken off: the name goes into the notebook, and the site becomes the organization's own site, which its profile step uses. |
| `ask` | string | one of `template` / `ask` | What the notebook is for, in a sentence. |
| `title` | string | no | Its title. Otherwise it comes from the draft, or from the template's name with the subject added ("Company briefing: Duolingo"). |
| `fresh` | boolean | no | With `ask`: draft a new notebook even when one of their templates looks like it fits. |
| `start` | boolean | no | Start its first step once it's made. It's off by default, so the notebook waits for you to press **Next step**. |

**Templates first.** The tool's description tells the client to list templates with `notebook-templates` and use one that fits. Each is listed with what it's for, its steps, the page it opens on and the subject it needs. When an `ask` looks like one of them anyway (the same kind of notebook: a meeting, a briefing, a plan, or a choice that shares a word of the template's name), nothing is started. The reply names the template or two that fit and says how to call again with one, or with `fresh: true` to draft the ask regardless.

### What `notebook-templates` returns

```
Templates (most used first). Pick the one whose "For" matches what the person wants: a meeting briefing prepares for a meeting with someone, a company briefing is about a company with no meeting in view.

- meeting-briefing: Meeting briefing
  For: Prepare sourced talking points and questions for my meeting with <subject>, from their profile and relevant public sources.
  Steps: Learn about <subject> → Find 5 meeting topics → Check topics and sources → Write the talking points
  Page: Meeting briefing
  Subject: Who you're meeting (a person or company), e.g. "Dana Reyes"
  Asks the person for: <subject>'s LinkedIn profile

- company-briefing: Company briefing
  For: Create a company briefing for <subject>.
  Steps: Learn about <subject> → Find 5 sources on <subject> → Verify briefing claims → Write the company briefing
  Page: chosen when it’s made, to fit what it’s for
  Subject: The company (its name, and website if you have it), e.g. "Northwind"
```

`<subject>` marks where the subject goes. "Page: chosen when it's made" means the template has no page of its own, so sua picks one when the notebook is made (a company briefing gets the Company briefing page).

### When an ask fits a template

`{"ask": "Prep me for my call with someone at Duolingo"}` starts nothing and replies:

```
Nothing started yet: one of the person's templates looks like it fits this ask.

- meeting-briefing: Meeting briefing
  For: Prepare sourced talking points and questions for my meeting with <subject>, …
  …

To use one, call notebook-create again with template: "meeting-briefing" and subject (who or what it's about). If none is right, call again with the same ask and fresh: true.
```

The match uses no model. It compares the kind of notebook the ask and each template are for: preparing for a meeting, a briefing or report, a plan, or a choice. A choice also has to share a word with the template's name ("buy", "job"). Archived templates are never suggested. An ask no template fits is queued straight away.

### A typical call sequence

1. `notebook-templates`: pick the template whose "For" fits.
2. `notebook-create` with `template` and `subject` (and `start: true` to run its first step).
3. `notebook-create-status` with the request id until it's `ready`.
4. `notebook-read` with the notebook id, once its steps have run.

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
