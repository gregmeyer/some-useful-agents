---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notebook options record their facts, so they can be compared.

- **Fields:** a notebook now has fields, the facts every option records (price, miles, year, location and listing for a car; rent and sq ft for a flat). sua's notebook keeper sets them the first time a run finds options. Each field can have a role (`price`, `measure`, `place`, `link`, `image`, `when`), so one widget works for any notebook.
- **Facts:** options carry their facts as data, and the page shows them as chips with the listing as a link.
- **Fingerprints:** an option found again by a later run is updated, not added twice.
- **Older options:** options kept before the notebook had fields are filled in from their text, using only the facts that can be read unambiguously.

`GET /notebooks/<id>/data.json` returns any notebook in one shape (limits, criteria, fields, options, notes, history), for the notebook widgets that come next.
