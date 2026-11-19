# ADR-0082: Tracing an answer's sources

- Status: accepted
- Date: 2026-11-19
- Deciders: Greg Meyer

## Context

An answer notebook runs find → check → write. The check step was made for shortlists: it checks each option against the notebook's checks. An answer has no options, so its check step did nothing and said "0 of 0 checked".

Each page an answer learns from is filed with a quote the finder copied from it. Nothing confirmed that the quote is really on the page. A finding could rest on a quote a model misremembered, and the answer couldn't say which of its findings trace back to their source (SIFT: trace claims to the original).

The checker already confirms an option's quotes word for word, in Python inside its agent.

## Decision

**On an answer notebook with no options, the check step traces its sources, in code.** No model is involved.

- **Each page, once.** For each evidence page not traced yet (up to 30 per press, 4 at a time), it reads the page and looks for the quote it was filed with. It reads the page as downloaded first, then as `web-fetch` reads it (a browser render when the download is thin). Both go through `web-fetch`'s address guard.
- **Word for word, spacing aside.** Quote marks, dashes, markdown and case are made plain. Whitespace is ignored, because a page's markup leaves spaces the words don't have ("open , lightweight", "( frontend"). A quote under 15 characters doesn't count.
- **What it found is kept on the source**: `found`, `missing` (the page was read and the quote isn't on it), `unread` (blocked, gone, timed out) or `no-quote` (filed without one), with when. It is stored as `NotebookEntry.trace`, column `trace_json`. Every entry filed from the same page gets that page's result.
- **The step counts sources traced** ("9 of 12 sources traced"). It is met when every page has been looked at, whatever was found. A new source makes it unmet again, and pressing it traces only what's new.
- **A finding's status comes from what it cites.**
  - *verified*: a cited quote was found on a primary page (the thing itself: its spec, docs or repo; a subject's own page counts as primary, per ADR-0081);
  - *supported*: a cited quote was found on another page;
  - *unverified*: the cited sources were traced and no quote was found.
  - A source without a quote neither confirms nor undercuts.
  - This is `findingTrace` in core, pure. The page and the brief show it as a small tag after each finding.
- **The writer sees it.** Each source it reads says whether its quote was found on its page. It is told to lean less on one that wasn't, and not to rest a finding on it alone.

## Consequences

- An answer's check step does something: "0 of 0 checked" becomes a count of sources traced, and each finding says whether what it cites is really on the page.
- *Verified* means traced to the original, not independent. A finding verified on a project's own docs still has the ADR-0081 caution when no outside publisher backs it. The two answer different questions.
- A page that blocks automated readers stays `unread`. Nothing screenshots it, as the checker's second look does; that could be added.
- The trace is kept per source, not per answer: writing the answer again doesn't trace again, and a finding's tag follows whatever its sources say now.
- The confidence is still the writer's word. Capping it in code, from these traces and the independent publishers, is the next step.
