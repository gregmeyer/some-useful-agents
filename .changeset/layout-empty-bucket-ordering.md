---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Three layout-planner fixes after live testing.

1. **Empty containers no longer render.** `widget-layout.js.ts` skips a container at render time if none of its tile ids resolve to a rendered tile in the DOM (e.g. the planner included no-signal agents, or a tile was hidden between sessions and its id lingers in the saved layout). Edit mode still shows empty containers so the user can drag.
2. **Planner orders containers by glance-value.** Prompt updated: high-frequency / daily containers go near the top of the array (containers render top-to-bottom); engineering/admin/infra containers go lower; system tiles anchor either the very top or the very bottom, not the middle.
3. **Planner explicitly told not to include no-signal agents in containers.** Belt-and-suspenders: even though `gatherAgentMetadata` already filters them, the prompt now spells out that an AGENT_METADATA entry without a `title` means the agent has no Pulse signal and placing it in a container leaves the container empty.
