# Tools

A **tool** is a named, reusable unit of work a node invokes by reference. Each tool declares typed inputs and outputs; the executor validates both at save time (template paths) and run time (output framing).

```yaml
nodes:
  - id: fetch
    type: shell
    tool: http-get
    toolInputs:
      url: "https://api.example.com/items"
```

This page is the index. Each builtin, plus the MCP tool type, has its own page below.

## Implementation types

| Type | Runs as | Typical use |
|---|---|---|
| `shell` | Child process via `bash -c` | Calling shell utilities, local binaries, `curl`, `jq` |
| `llm-prompt` | LLM CLI selected by `provider:` (`claude --print` or `codex exec`) | Prompting an LLM with run context. Legacy alias: `claude-code`. |
| `builtin` | Direct in-process function call | Performance-critical things the runtime ships |
| `mcp` | Pooled MCP client → remote server | Integrating third-party MCP servers |

## Built-in tools

The tools below ship with the runtime. Each is trusted (source: `builtin`) and bypasses the community-shell gate. To run an LLM prompt, use `type: llm-prompt` on the node (not a `tool:` reference) — see [agents.md](agents.md#node-types).

| Tool | Purpose |
|---|---|
| [`shell-exec`](tools/shell-exec.md) | Run an arbitrary shell command |
| [`http-get`](tools/http-get.md) | HTTP GET with SSRF protection |
| [`http-post`](tools/http-post.md) | HTTP POST with SSRF protection |
| [`web-fetch`](tools/web-fetch.md) | Fetch a public web page as clean, readable text for a model |
| [`web-scrape`](tools/web-scrape.md) | Extract structured data from a page (JSON-LD, metadata, optional rendered HTML) |
| [`web-screenshot`](tools/web-screenshot.md) | A picture of a page as a browser shows it, kept with the run (shown on the run page) |
| [`file-read`](tools/file-read.md) | Read a file within the project root |
| [`file-write`](tools/file-write.md) | Write a file within the project root |
| [`json-parse`](tools/json-parse.md) | Parse a JSON string into structured fields |
| [`json-path`](tools/json-path.md) | Extract a value from JSON via path |
| [`template`](tools/template.md) | Interpolate `{{inputs.X}}` into a template string |
| [`csv-to-chart-json`](tools/csv-to-chart-json.md) | Convert CSV into the JSON shape modern-graphics expects |
| [`oauth-loopback`](tools/oauth-loopback.md) | One-time OAuth2 authorization-code loopback; saves a refresh token to the vault |
| `ask-human` | Ask the person mid-node; the run waits for the answer in the inbox, then the node starts again with it. Add to a node's `tools:`; see [ask-a-person.md](ask-a-person.md) |
| `board-read`, `board-place` | Read and arrange a board (Pulse or a named dashboard): its sections, tabs, rows, grids and tiles, with the same operations as the Arrange editor, saved as an undoable version. Also offered over MCP; see [tools/board-place.md](tools/board-place.md) |
| [`experiment-read`](tools/experiment-read.md) | Read what an experiment found: its question, the finding and what it rests on, its setup, each version against the baseline, what each version found, its runs. Counted from its runs. Archived ones too. Also offered over MCP |
| [`notebook-read`](tools/notebook-read.md) | Read what a notebook knows: who it's about (facts with sources), what it wrote, its options with facts and checks, its notes. Archived ones too. Also offered over MCP |
| [`notebook-create`](tools/notebook-create.md) | MCP only: start a new notebook from a template (`notebook-templates` lists them) or from an ask sua drafts, optionally starting its first step; `notebook-create-status` follows it |
| `notebook-tldr` | MCP only: redraw a notebook's TL;DR picture: show how it's drawn, set its size, tone, layout, parts, headline and takeaway, undo, or go back to the standard one. Numbers in its words must be ones the notebook has. See [notebooks.md § The TL;DR picture](notebooks.md#the-tldr-picture) |
| `memory-save`, `memory-search`, `memory-forget` | An agent's own memory across runs. Offered automatically to agents with `memory:` on; see [memory.md](memory.md) |

## MCP tools

Tools imported from an MCP server. See [`tools/mcp.md`](tools/mcp.md) for the type reference and [MCP servers](mcp.md) for the server-management flow.

## Tools you add

A tool you add is a **command** or a **prompt** with named inputs. Write it in the dashboard (**Tools → + New tool**, where **Try it** runs it once before you save; see [the New tool page](dashboard.md#toolsnew--new-tool)), or as YAML added with `sua tool add <file>` (run it again to update; `sua tool validate <file>` only checks; `sua tool remove <id>` removes it). Design notes: [ADR-0102](adr/0102-tools-you-add.md).

**Ideas from your agents.** Describe it opens with up to five ideas taken from your own agents, worked out without a model: a web address that two or more of your agents fetch (each in its own way), or near-identical commands in two or more agents. Each card says which agents it came from; **Use this** puts a ready-to-draft sentence in the box. An address a tool you already have uses isn't suggested again.

**Or start from…** Under the ideas, ask sua for ideas starting from **an agent** (pick one: it reads its steps and suggests tools that would make it simpler, or that other agents could use too), **an input** (paste a sample, a URL, or say what it is: a bank statement CSV, a meeting transcript) or **an outcome** (what you want to end up with). Up to four ideas come back as the same cards, each saying how it helps; asking the same again within the hour gets the same ideas.

**Make a tool from this step.** A command or prompt step has **Make a tool** (on the agent's Nodes tab, and in the diagram's step dialog). It opens Describe it with that step's command or prompt, asking for its hard-coded values as inputs.

**Ask sua to share a tool.** In a conversation, say which agents keep doing the same job ("point my job-board agents at a shared tool"). sua drafts one tool for what their command steps do (or uses one of yours that already does it), rewrites each agent to call it, and shows it all on one card: the tool, each agent's change with its diff, and any agent left out and why. Approving saves the tool and every agent together (each as a new version you can roll back from Versions), or nothing if any of it fails. An agent's change must keep what the agent gives back. Design notes: [ADR-0103](adr/0103-a-shared-tool-on-one-card.md).

**Describe it.** On **Tools → + New tool**, the first tab takes a sentence ("look up a word on dictionaryapi.dev and give back its first definition") and sua's tool drafter writes the tool: its id, inputs, output fields, the command or prompt, and a sample to try it with. The draft is checked like a tool you wrote, and also must use every input it declares and have no key written into it. A draft that doesn't check out is sent back once or twice with what was wrong. Then it opens in the form, filled in, with a note on what it does: read the command, press **Try it**, change anything, and **Save tool**. Nothing runs before you press Try it, and nothing is saved before you press Save. Drafts are kept for an hour.

```yaml
id: word-count
name: Word count
description: Counts the words in some text
inputs:
  text: { type: string, required: true }
  unit: { type: string, default: words }
outputs:
  count: { type: number }
implementation:
  type: shell
  command: |
    n=$(printf '%s' "$text" | wc -w | tr -d ' ')
    echo "{\"count\": $n, \"unit\": \"$unit\"}"
```

- **Inputs reach a command as environment variables**, named as you declared them: `$text`, `$unit`. They're never pasted into the command, so always quote them (`"$text"`): unquoted, a value with spaces or a leading `-` changes what runs. `sua tool add` warns about an unquoted input, `eval`, `rm -rf`/`sudo`, and curl or wget fetching a URL from an input. That last one can reach `file://` and your own network; for a plain fetch, use the `http-get` tool, which checks the address first.
- **Input names** are letters, digits and `_`, and can't be ones the environment or sua already uses (`PATH`, `HOME`, `http_proxy`, `UPSTREAM_…`, `SUA_…` and the like, in any case).
- **Only declared inputs are accepted.** A default fills a gap, a missing `required` input fails the step, and an input the tool doesn't declare is refused.
- **Outputs:** print one line of JSON at the end; its keys become the step's output fields (`{{upstream.count.count}}`). The whole of stdout is `result`.
- **Secrets:** a tool gets the calling step's environment, including the secrets that step declares (`secrets: [API_KEY]` on the step, then `$API_KEY` in the command). Never write a key into the command. An input can't have the same name as one of those secrets.
- **A prompt tool** has `implementation: { type: llm-prompt, prompt: "Summarise {{inputs.text}} in three bullets." }`, and `{{inputs.x}}` is replaced in the prompt.

Use one as a step:

```yaml
- id: count
  type: shell        # any type; the tool decides what runs
  tool: word-count
  toolInputs:
    text: "{{upstream.fetch.result}}"
```

A **command tool** can also be called by a model: put it in an `llm-prompt` or `goal` step's `tools:` list, and the model fills in its inputs. A prompt tool can only be a step for now. In a community agent, a step whose tool, or whose `tools:` list, can run a command needs the same opt-in as a shell step (`--allow-untrusted-shell`). To keep agents off a tool you added, deny it by id in a [tool policy](tool-policies.md).

## Input / output mapping

- **Inputs** come from the node's `toolInputs:` block (or `config:` for project defaults). Values flow through template resolution (`{{upstream.*}}`, `{{vars.*}}`) before reaching the tool.
- **Outputs** are extracted from the tool's result: the keys of the last line of stdout when it's JSON. Downstream nodes reach them via `{{upstream.<nodeId>.<field>}}`.

Every tool also produces a synthetic `result` field (full stdout for shell, assistant text for llm-prompt) for v0.15 backcompat.

## `config` vs `toolInputs`

Tools can declare project-level `config:` defaults that every invocation inherits. Per-invocation `toolInputs:` overrides specific keys.

```yaml
# Tool YAML
id: http-get
implementation:
  type: builtin
  builtinName: http-get
config:
  timeout: 30
  headers: { User-Agent: "my-org" }

# Node YAML
- id: fetch
  tool: http-get
  toolInputs:
    url: "https://api.example.com"   # timeout + headers inherited from config
```

Config values can reference secrets (`{{secrets.NAME}}`) and global variables (`{{vars.NAME}}`).

## Related

- [Agents reference](agents.md) — how nodes reference tools
- [MCP servers](mcp.md) — importing third-party tools
- [Templating](templating.md) — `{{inputs.X}}`, `{{upstream.X.result}}` in tool args
- [Security model](SECURITY.md) — SSRF, path traversal, shell gate
