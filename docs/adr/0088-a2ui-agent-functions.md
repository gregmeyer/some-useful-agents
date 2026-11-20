# ADR-0088: A2UI agent functions

- Status: accepted
- Date: 2026-11-20
- Deciders: Greg Meyer

## Context

A notebook page is drawn from data the server works out when it renders. To show something else, a page had to be redrawn with more data: a search over a long shortlist, or one option's facts on demand.

A2UI 1.0 lets the renderer call a function it doesn't implement itself. It sends `callAgentFunction` to the agent and draws the answer from `agentFunctionResponse`. The renderer caches answers and calls again when an argument's bound data changes.

## Decision

**Two agent functions, declared with no implementation** in both the sua catalog (core `SUA_AGENT_FUNCTIONS`, so pages validate) and the browser (`assets/sua-functions.js`). The renderer therefore routes every call to the dashboard:
- **`findOptions(q, limit)`:** the notebook's options in the running whose name or facts contain every word of `q`, best first by its ranking, as Table rows (`id`, `name`, `page`, `link`, and each fact by field key, worded as the page shows it). `limit` defaults to 10, at most 50.
- **`optionFacts(id)`:** one option's facts as `{label, value}` rows for a KeyValue.

**The page sends the call, the server answers it.** The page's processor has an outbound listener that posts the call to `POST /a2ui/agent-functions` and feeds the answer back into the same processor. `lib/a2ui-agent-functions.ts` answers:
- only for a notebook's own page (`notebook-<id>` or its header), and only about that notebook;
- read-only;
- anything else is an error (`NOT_FOUND`), which draws as nothing.

The route sits behind the dashboard's sign-in and origin checks.

**The notebook-page guide** names them and shows a search box: a TextField bound to `/form/q` and a Table whose rows call `findOptions` with it.

## Consequences

- A page can search a long shortlist as you type, without the server rendering it again. In the browser, typing "analyst" in the job notebook drew only its analyst roles, and a word that matched nothing drew an empty table.
- Answers are worked out from the store on each call; the renderer caches them per surface.
- Functions that change things (run a step, rule an option out) stay as actions. A function call reads.
