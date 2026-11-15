# ADR-0080: A briefing on a subject

- Status: accepted
- Date: 2026-11-14
- Deciders: Greg Meyer

## Context

"Tell me about Roam School Family <its site>" was drafted as a question to answer: find sources, check claims, write the answer. That was the only rule the drafter had that fit. The result was poor in ways that all trace back to the notebook not knowing it was about one named thing:

- No profile step, so no organization profile, logo, site or competitors. The page chooser's rules named the answer page and never the company page.
- The writer wrote one paragraph and four findings: it writes further parts only when the ask names them, and "tell me about X" names none.
- The finder is told that a notebook ending in a written answer needs "sources that explain how it works and what to weigh" from "regulators, official bodies and reputable guides". For a question about one organization it filed home-education law in England and school rules in the EU. Five of its six real sources were the subject's own site.
- The link in the ask was passed to the profile researcher only as a hint for telling namesakes apart.
- Seven pictures were kept for its sources and shown nowhere, on the page or in the PDF.

The person had to tell sua to run more research and to change the page by hand, and the PDF still had no pictures.

## Decision

**A notebook can be a briefing on a subject, and says so.** `Notebook.briefOn` holds the subject: its name as written, its kind (organization, person, product, topic) and its own site when a link was given. It is set from the draft (`about` in the drafter's output) and carried by Run again and by experiment copies.

Everything else follows from that one fact, in code where it can:

- **The drafter** recognizes the ask and lays out profile (organization or person only) → find → check → write. The write step stays `shape: answer`: what is written is still kept as the notebook's answer. Whether it is a briefing on a subject is read from `briefOn`, not from a new shape, so the two dozen places that branch on the shape are untouched.
- **The finder's brief** (`subjectBrief`) replaces the "sources that explain" line: every search is about the subject, its own site is covered, at least three sources are not its own site, and no general guidance pages are added. The finder plans its searches by kind of source and names the subject in each.
- **The profile step** keeps the site you gave as an organization's website over one research found on another host (`withGivenSite`), and uses it for the logo.
- **The page** is the `subject` preset, set in code when the notebook is created (no run is spent choosing it) and kept as its kind when it is composed around what was written.

Later changes under this ADR: the briefing's parts (what it is and who is behind it, what it offers and who it's for, how it works and what it costs, what others say), a source page's own picture kept and shown on the page and in the brief, and the TL;DR picture using those pictures.

## Alternatives

- **A new write shape (`overview`).** The first plan. Rejected on reading the code: about 25 places branch on `shape === 'answer'`, and each would need the new shape added or it would silently fall through to talking points. One fact on the notebook is read where it matters.
- **Use the Company briefing.** It exists as a page and, for the user, as a template, but the drafter knows neither, a topic or a product has no company profile, and its page has no place for the briefing's parts.
- **Leave the kind to the page chooser and the finder's judgment.** That is what failed: neither was told the notebook was about one thing.
- **Filter off-topic sources after the search.** Cheaper to not ask for them; the finder is also told a page that doesn't name the subject isn't a result.

## Consequences

- A question that is not about one named thing is drafted as before.
- A briefing's search costs the same number of searches, spent differently (by kind of source).
- Notebooks made before this have no `briefOn`; they keep behaving as answer notebooks. Clear and run again drafts nothing new, so an old one becomes a subject briefing only by starting a new notebook.
- The drafter decides whether an ask is about one named thing. When it gets that wrong the notebook is an ordinary answer notebook, which is today's behavior.

## Amendment (2026-11-14): the briefing's parts

The writer is given `briefingOn` with four parts (`BRIEFING_PARTS`: what it is and who is behind it; what it offers and who it is for; how it works and what it costs; what others say) and each source marked as the subject's own page or not. It writes a two-sentence lead and one section a part, text or a table, each citing its sources.

Code holds it to that (`cleanAnswer` with `BriefingRules`): a part that cites no source is dropped; "what others say" is dropped unless it cites a source that is not on the subject's own site; a part takes its standard title and ticks the done-when that names it, whether or not the writer said so. An ordinary answer keeps its limits (one text part, five sections).

The subject page is not composed again once the briefing is written. Composing picks one part as a hero and files the rest under "Also written", which is wrong for parts that are meant to be read in order.

## Amendment (2026-11-14): pictures

The first notebook kept seven pictures and showed none: its page drew sources as a table, the brief's `OptionGrid` was three text columns, a `Stories` part vanished from the brief, and the page chooser was never told the sources had pictures.

- **A source page's own picture is the source's picture.** For a subject briefing `keepPhotos` keeps a page's `og:image` without the listing tests (an id in the address, a title naming the option), which only make sense for listings. No image search runs for these notebooks (`startNotebookPictures` only marks drawings): an "example photo" of a named subject may not be of it.
- **Pictures decide the layout.** `evidenceLayout` resolves to `grid` when any source has a picture of its own, else `table`, on the subject, answer and company pages. The page chooser is told how many have one and to show them as cards or stories.
- **The brief draws what the page draws.** An `OptionGrid` that isn't a table is cards with pictures; `Stories` has a case; the lead's picture may be a kept photo. Saved as a file or a PDF, the pictures are embedded.

