---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

An agent's Latest result reads clearly when it has no widget, or its last run failed.

- **A failed newest run** gets a red card with its error, Open the run, and Ask sua to fix it. The result below is titled "Last good result".
- **Output with no widget** that is one JSON object shows as labelled facts, and a JSON list of records as a table. The raw text is under Raw output.
- **Widgets** draw a list of records in a text or code field as a table, and leave out fields with nothing in them.
- **Agents other agents or notebooks call** list their last few results, each as the input and the answer in a line.
