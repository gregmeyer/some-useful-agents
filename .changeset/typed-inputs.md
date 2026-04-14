---
"@some-useful-agents/cli": minor
"@some-useful-agents/core": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

**feat: typed runtime inputs for agents.** Callers can now supply named, typed values at invocation time and agents substitute them into prompts or read them as environment variables. Closes the "I want my agent to take a parameter" story.

### Declare once, use everywhere

```yaml
name: weather-verse
type: claude-code
prompt: "Weather for zip {{inputs.ZIP}} as a {{inputs.STYLE}}."
inputs:
  ZIP:
    type: number
    required: true
  STYLE:
    type: enum
    values: [haiku, verse, limerick]
    default: haiku
```

```bash
sua agent run weather-verse --input ZIP=94110
sua agent run weather-verse --input ZIP=10001 --input STYLE=limerick
```

### Two execution models, one declaration

- **claude-code agents** — `{{inputs.X}}` in the prompt (and in `env:` values) is substituted before spawn. Claude reads the resolved text; no injection class because prompts aren't executed.
- **shell agents** — declared inputs become env vars. Authors write `"$ZIP"` in their commands; bash handles quoting. `{{inputs.X}}` inside a shell `command:` is rejected at load time with a clear error pointing to the `$X` form.

### Types

| `type` | Accepts | Notes |
|---|---|---|
| `string` | any string | default if unspecified |
| `number` | `Number(x)` must be finite; empty string rejected | renders as decimal string |
| `boolean` | `true/false/1/0/yes/no` (case-insensitive) | renders as `"true"` / `"false"` |
| `enum` | values listed in the spec's `values` array | must declare `values` |

Type is for *validation at the boundary*, not downstream coercion. Every resolved input renders as a string — `{{inputs.VERBOSE}}` with `VERBOSE=true` substitutes the literal text `"true"`.

### Precedence (highest wins)

1. `sua agent run --input K=V` (per-invocation)
2. `sua schedule start --input K=V` (daemon-wide override, applies to every fired run; agents that don't declare the input ignore it)
3. YAML `default:` (per-agent)
4. Else fail loudly (`MissingInputError`, `InvalidInputTypeError`, `UndeclaredInputError`)

### Load-time checks

- `inputs:` names must be `UPPERCASE_WITH_UNDERSCORES` (env-var convention)
- `type: enum` must declare a non-empty `values:` array
- Every `{{inputs.X}}` in prompt or `env:` values must appear in the `inputs:` block (typos caught before execution)
- Shell `command:` cannot contain `{{inputs.X}}` — use `$X` instead

### Run-time checks

Ordered: undeclared provided key → invalid type → missing required. All fail before spawn, recorded as a failed run in history.

### New exports from `@some-useful-agents/core`

- `AgentInputSpec` type
- `inputSpecSchema` — zod schema
- `resolveInputs(specs, provided, options?)` — returns resolved string map or throws
- `validateAndRender(name, spec, raw)` — single-value validator
- `extractInputReferences(text)` — returns set of `{{inputs.X}}` names
- `substituteInputs(text, resolved)` — applies the map to a string
- `MissingInputError`, `InvalidInputTypeError`, `UndeclaredInputError`
- `RunRequest` — formalized `submitRun` request shape with optional `inputs`

### API changes (library consumers)

- `Provider.submitRun(request: RunRequest)` — request type now has `inputs?: Record<string, string>`.
- `ExecutionOptions.inputs?: Record<string, string>` on `executeAgent`.
- `ChainOptions.inputs?: Record<string, string>` on `executeChain` — flows to every agent in the chain.
- `LocalSchedulerOptions.inputs?: Record<string, string>` — daemon-wide overrides applied to every fired run.
- Temporal activities/workflows carry `inputs` in their payload so workers on other hosts inherit the caller's input values.

### Docs

- README commands table and full-fat YAML example updated to show `inputs:` and `--input`.
- ROADMAP lists v0.9.0 under "Now".
- `sua agent audit` prints declared inputs with types, defaults, required flags, and descriptions.
