# ADR-0087: sua's A2UI functions

- Status: accepted
- Date: 2026-11-20
- Deciders: Greg Meyer

## Context

A2UI lets a value be a function call (`{"@call": name, "args": {…}}`). Inside `formatString`, a template can call one: `${fn(arg:${/path})}`.

sua had only the basic catalog's functions (`formatString`, `formatNumber`, `formatCurrency`, `formatDate`, `pluralize` and the checks). So a view couldn't do several common things:
- say a list as words;
- say "3 days ago";
- say a salary range;
- count a list.

A form's message (ADR-0084 PR 4) wrote a chosen option as JSON, `["rental"]`.

## Decision

**Four functions in the sua catalog, run in the browser** (`assets/sua-functions.js`):
- `join` (a list as words, optional separator and `last`);
- `relativeTime` ("3 days ago", "in 2 hours", "just now");
- `formatRange` ("$120K–$140K" with a currency code, "120–140" without);
- `count` (a list's length).

Each is a 1.0 function implementation, `rendererOnly`. Its argument schema is built from the renderer's own `z` and common schemas.

**The server validates the same names and arguments** (`SUA_FUNCTIONS` in core's catalog). There they never run. A test keeps the browser and server lists in step, as for components. An unknown function or argument is refused. The catalog document (ADR-0085) describes them.

**The guides name them.**
- The agent-view guide lists them in a line.
- The notebook-page guide shows one inside `formatString`.
- The reply-form example writes a choice with `${join(value:${/data/form/kind})}`, so the message says "rental" at the source. The tidy-up of list text in action messages stays as a fallback.

## Consequences

- Pages and views can say these things without new components or a round trip. A count, a range or "3 days ago" stays live as the data changes.
- `relativeTime` is worked out when the value changes, not as time passes.
- The size budgets of two prompts grew by 150 characters each to name the functions.
- **Not done:** agent functions (A2UI 1.0's `callAgentFunction`), where a page asks the server for something and draws the answer. They need a channel from the browser to the server and back, and a check that a function only reaches its own notebook or agent. That is its own piece of work.
