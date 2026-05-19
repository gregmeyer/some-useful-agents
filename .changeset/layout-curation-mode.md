---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Layout planner becomes curation, not just rearrangement.

Previously the planner bucketed every visible agent — typically dumping the long tail into an "Other" container. That's not what users actually want when they invoke "Improve layout": they want the top ~12 agents surfaced and the rest hidden. This release makes that the default behaviour.

Changes:
- **Prompt** (`agents/examples/layout-planner.yaml`): capped \`topAgents\` at 12, explicitly told the LLM that anything not in a container will have its \`pulseVisible\` set to false, and forbade catch-all "Other" / "Misc" containers.
- **Commit endpoint** (`POST /pulse/layout-plan/commit`): no longer a no-op. Walks the agent store, sets \`pulseVisible=false\` on any visible agent absent from the plan's containers, and \`pulseVisible=true\` on any container-mentioned agent that was previously hidden. System tiles (`_system-*`) are skipped. Returns \`{ hidden: string[], unhidden: string[] }\`.
- **Modal UI**: the proposed-layout screen now shows a "Will hide N agents" `<details>` block listing the agent ids that will be hidden, between the containers and the Apply button. Apply waits for the server commit before reloading.

Hidden agents remain restorable from the "hidden signals" details section below the Pulse grid — single click brings them back.
