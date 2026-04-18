# ADR-0017: Agent analyzer as a self-correcting agent pipeline

## Status
Accepted

## Context
The "Suggest improvements" feature initially used custom routes, views, polling JS, and an in-memory job store. This was a lot of infrastructure for one feature. The codebase already had everything needed: the DAG executor, agent inputs, the run system, and the dashboard run polling.

Additionally, AI-generated YAML suggestions frequently had schema errors (lowercase input names, missing enum values, invalid template syntax). Users hit validation errors when trying to apply suggestions.

## Decision
Build the analyzer as an example agent (`agent-analyzer.yaml`) instead of custom infrastructure. The dashboard "Suggest improvements" button runs the agent with the target agent's YAML as an input, polls the run status, and renders results in a modal.

The agent is a 3-node self-correcting pipeline:
1. **analyze** (claude-code) — produces suggestions + YAML
2. **validate** (shell) — extracts `<yaml>` from output, runs `parseAgent` deterministically
3. **fix** (claude-code, onlyIf validate failed) — takes validation errors + original suggestions, produces corrected YAML

The fix node only runs when needed. When validation passes, the analyze node's output is the final result.

## Consequences
- Zero new polling/job/progress infrastructure — reuses the existing run system
- The analyzer itself is editable YAML (users can tune the prompt)
- Every analysis is a run in history (auditable, replayable)
- The validate node catches schema errors deterministically before the user sees them
- Multi-node agents exercise their own flow-control features (onlyIf, dependsOn)
- Analysis takes longer (3 nodes vs 1) but produces cleaner output
