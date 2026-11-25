# 0104. A pinned Claude short name applies on Claude only

- Status: accepted
- Date: 2026-11-25

## Context

A real question cost about $10 before reaching an answer, most of it in worker nodes (the finder's searches, research-one, the checker's page look) running on the default model. Agents could pin `model:` per node, but a pinned model went to every provider in the order: `model: sonnet` sent to codex fails as model-unavailable, marks the model unavailable, and fails the node when codex is the only provider. So nothing sua ships pinned a model.

## Decision

- A node's `model:` that is one of the Claude CLI's short names (`sonnet`, `haiku`, `opus`, `fable`…, with or without a context tag; `isClaudeAlias` in `claude-models.ts`) applies only when the provider is `claude`. Any other provider runs the node on its own model from Settings → LLM, as if nothing were pinned.
- Any other pinned model (`gpt-6-luna`, a full Claude model id) still goes to every provider, as before.
- sua's own worker nodes pin `model: sonnet`: notebook-find-one `find`, research-one `research`, notebook-checker `look`, notebook-page, notebook-picture, notebook-tagger. Single-turn nodes that set quality (the finder's plan, the checker's judge, the drafter, the writer) keep the default.
- An experiment that swaps the model still wins: it sets the model on every model node (`agentForCondition`).

## Consequences

- On Claude, those workers cost less per turn; on codex or an OpenAI-compatible endpoint, nothing changes.
- A user who wants a worker on another Claude tier edits its YAML; a Settings knob per node isn't offered.
