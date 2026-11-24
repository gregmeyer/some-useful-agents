---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Describe a tool and sua drafts it: Tools → + New tool → Describe it.

A sentence in, and sua's new `tool-drafter` agent writes the tool (id, inputs, output fields, the command or prompt, and a sample to try). The draft is checked like a tool you wrote, must use every input it declares and have no key written into it, and is sent back with what was wrong up to twice more. It then opens in the New tool form, filled in, for you to read, Try and Save; nothing runs or is saved before you press those. Try it's sample inputs now read `name: value` lines by their first colon, so a value can contain colons, and a command that reads an input by name (`os.environ["text"]`) counts as using it.
