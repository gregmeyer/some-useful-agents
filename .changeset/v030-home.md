---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Home, redesigned: a page of what needs you, and a shelf of your notebooks.

Home is now drawn from a goal surface (ADR-0049): an item index of everything that needs you, and a versioned surface model of your goal, rules and pins. See [docs/surfaces.md](https://github.com/gregmeyer/some-useful-agents/blob/main/docs/surfaces.md).

- **Today** shows only what needs you, and says why. Pin, move or hide things, turn a change into a rule, or ask sua to change Home. What changed is listed, with Undo, and Home keeps itself current. Dismissed things stay dismissed.
- **A notebooks shelf** on Home, with each notebook shown once.
- A one-line header, and the dashboard fits on a phone.
