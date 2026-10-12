---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's page tells its story: where it stands, what to check, how you got here.

The widgets now follow the notebook design:
- **Where it stands** with a **Next** step, beside **Done when** (a ring and steps), and boxed stats.
- **The price map** beside the funnel.
- **A shortlist** with short names and a "No photo yet" placeholder. Ruled-out options are hidden by default (**Show ruled out**).
- **Before you decide**, a checklist for the top two that you tick in place.
- **How we got here**, a timeline.
- **Where sua looked**, the sites the latest search reached.
- **Limits**, with ones that disagree flagged.

The old notes list is folded into the timeline.

**No longer available** is now the first choice under **Rule out…** (also **Mark gone** on "not seen lately" cards, or tell sua "it sold"). It takes an option out of the running without counting as your rejection.

**Fact checks:** facts that contradict an option's own text (a model mixing up two options) are corrected from the text, including ones already stored. Fields without a role get the one their name implies.

The sua catalog gains `Columns`, `Panel`, `Callout`, `StatStrip`, `Steps`, `Coverage`, `Checklist`, `Timeline` and `ChipList`.
