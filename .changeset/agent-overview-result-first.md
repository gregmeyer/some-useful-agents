---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

An agent's Overview leads with its latest result.

The agent page now opens on what the agent makes: its last finished run, drawn like the run page (view, widget or text), with a note when a run is in progress or the newest one failed, and **Run with different inputs** right there. Beside it, **At a glance**: the last runs as dots, version, model, when it runs, how results look, spend, tools, and who it calls and is called by. **How it works** lists the steps, with the diagram a click away. The header is **Ask sua**, a **⋯** menu (Suggest improvements, Redesign how results look, Edit the view, Versions, YAML) and **Run now**, and a long description folds to two lines. Fixed along the way: the diagram's Save wiring and Cancel showed before you started editing, the widget card could run off the page, and a widget whose fields aren't in the output showed an empty box (it now shows what the run said, here and on the run page).
