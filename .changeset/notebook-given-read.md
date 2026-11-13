---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

sua reads what you paste for a notebook into a short profile, shows it, and steps work from that.

A notebook that asks for your LinkedIn profile or résumé used to hand steps the first 8,000 characters of the raw paste, page clutter included, and kept at most 12,000. Now a small agent (`notebook-given-reader`) reads the whole paste (up to 40,000 characters) once into a summary and up to 30 facts, each with the words of the paste it came from; a fact whose words aren't in the paste is dropped. Steps receive that reading. The notebook's page shows it ("Your LinkedIn profile, as sua read it") with Fix this and Read it again, and Edit lets you correct it line by line. A reading that fails never blocks: the step starts on the text as pasted.
