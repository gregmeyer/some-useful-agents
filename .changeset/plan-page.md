---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/dashboard": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
---

A notebook that makes a plan gets the plan, day by day, on a page made for it.

A write step can now write a plan (`"shape": "plan"`, or `(write; plan)` in the Prompt tab): the plan in a sentence, each item in order with its day or slot, a line on when, how long or what it costs, and the options it uses, then what to book or do first and what's still open. The drafter ends a plan-shaped notebook (a trip, a week, a move, a project) with it. The new ready-made **Plan** page, which sua picks for these notebooks, shows it with a new **Itinerary** widget (day by day, Copy as text) beside the steps, then what it draws on. The brief prints it. Itinerary is in the A2UI catalog for boards and agent views too, and a page part can wait for a plan with `"when": "planned"`.
