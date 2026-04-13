# ADR-0013: Onboarding tutorial + dad-joke example agent

## Status
Accepted

## Context

After shipping npm publishing (v0.2.0), a fresh `npx @some-useful-agents/cli`
install still gave users an empty directory. `sua init` created config but
scaffolded nothing. A brand-new user had to:

1. Read the README
2. Hand-write a YAML file to an unfamiliar schema
3. Guess which command to run
4. Repeat for every concept (chaining, secrets, scheduling)

This is the highest-leverage surface for adoption. If the first five
minutes don't feel magical, the tool doesn't get past the tab they opened
it in. Docs can teach "what is sua" — but docs go stale, users skip them,
and LLMs are now answering most how-do-I-start questions anyway.

Two big design choices emerged:

### Walkthrough style: fixed vs fully LLM-driven

- **Fixed script** — sua owns the steps. Deterministic. Testable. Same
  ending state for every user.
- **LLM-driven** — sua hands Claude (or Codex) a system prompt describing
  itself and lets the LLM run the conversation. More flexible, less
  predictable, breaks when the LLM version drifts.

### Ending state: abstract or concrete

- **Abstract** — the tutorial shows the concepts but the user provides
  their own agent.
- **Concrete** — the tutorial builds a specific real agent, runs it, and
  schedules it.

### The example agent itself

Options considered: weather (needs API key), news (requires subjective
source), quote-of-the-day (bland), hello-world (no scheduling value),
dad-joke from icanhazdadjoke.com (fun, free, no auth, HTTP call,
schedulable).

## Decision

**Structure: fixed-script walkthrough with optional LLM deep-dives.** sua
drives 5 deterministic stages. At each stage, the user can type `explain`
to get Claude or Codex to riff on that specific concept. The LLM is an
enhancer; sua owns the flow.

**Ending state: concrete and scheduled.** The walkthrough scaffolds a real
`dad-joke.yaml`, runs it live (user sees an actual dad joke), and
optionally adds `schedule: "0 9 * * *"` to schedule it daily.

**Example: dad-joke.** Concrete, safe, external API call, scheduling value
is obvious ("I get a joke at 9am"), zero setup cost.

`sua init` also scaffolds a simpler `hello.yaml` so even users who skip the
tutorial get a non-empty `sua agent list` result.

## Consequences

**Easier:**
- First-run is one command: `sua tutorial`. No doc-reading required.
- Debugging: every stage is a deterministic prose block + a scripted action.
  Failure messages point at the specific stage.
- Works without any LLM CLI installed; the `explain` feature just disables.

**Harder:**
- Tutorial must be maintained as features evolve. If chaining syntax
  changes, stage 4 may need an update. This is actually a feature: keeps
  the docs from going stale.
- LLM deep-dives depend on Claude or Codex being installed. Users without
  either get the walkthrough minus enrichment. Documented.

**Trade-offs accepted:**
- Tutorial is a new maintenance surface area. For the adoption win, worth
  it. A slot-based architecture (stages as an array of step objects) keeps
  editing individual stages cheap.
