---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/dashboard": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
---

A notebook that asks a question gets an answer, on a page made for it.

A write step can now write the answer (`"shape": "answer"`, or `(write; answer)` in the Prompt tab) as well as talking points. sua's writer answers what the notebook asks from what it found. It says how sure it is (sure, fairly sure, not sure yet) and why, gives 3 to 6 findings, each linked to the sources it rests on, and lists what's still open. The drafter ends a question-shaped notebook with it instead of decide. The new ready-made **Answer** page, which sua picks for these notebooks, shows the answer (or where it stands until there is one), the findings and what's still open beside the steps, then the evidence as a table. The brief prints the same. Agenda gains `questionsLabel`, `watchLabel` and `empty`, Callout gains `nextLabel`, and a page part can wait for an answer with `"when": "answered"`.
