---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Write a tool in the dashboard: Tools → + New tool, with Try it.

The New tool page takes an id, a name, what it does, a command or a prompt, its inputs and its output fields (or the same tool as YAML), and **Try it** runs it once on sample inputs without saving it. Saving lists what stops it and what's worth a second look ("Save anyway"). A tool you added has Edit, Remove (which says which agents use it) and its YAML on its page; the first Tools tab is now **Your tools**. A tool with an empty command or prompt is refused. The executor takes `draftTools`, unsaved tools looked up before the store.
