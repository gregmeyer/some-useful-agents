# ADR-0081: Where an answer's sources come from

- Status: accepted
- Date: 2026-11-19
- Deciders: Greg Meyer

## Context

An answer notebook asked how three related projects differ. It said it was "high" confidence because "the sources agree". Of its twelve sources:
- six were one of the projects' own pages, three of them the same architecture page for different SDKs;
- one was a post co-written with that project;
- the rest were the other two projects' own docs.

No source came from outside the three, so the agreement was the subjects describing themselves.

Judged by the SIFT method (stop, investigate the source, find other coverage, trace claims to the original), the notebook retrieved well and investigated nothing. An evidence entry kept a page and a quote. It did not keep who published the page, and nothing compared the answer's confidence with where its sources came from. The writer's rule for "high" was "several good sources agree": a count, not a judgement of independence.

## Decision

**Every page an answer learns from carries its origin**: who publishes it, what kind of source it is (primary, vendor, independent, community), and whether it is one of the notebook's subjects speaking about itself (`NotebookEntry.origin`, column `origin_json`).

- **What the finder says comes first.** The learn search reports `publisher`, `kind` and `whose`, and sua's finder passes them on with the page. A model knows who makes a project; an address doesn't.
- **The address checks it.** A page whose site or code-host owner is named for a subject is that subject's own, whatever the finder said. A `whose` that names none of the subjects is ignored. A subject's own page with no kind said is primary. The publisher falls back to the address: a code host's owner, else the site without its subdomains. All of this is `sourceOrigin` in core, pure.
- **The subjects come from the notebook.** They are the briefing's subject, else the names in the title and statement: words with a capital after the first letter, a digit or a hyphen. No new field and no model call.
- **Publishers count once.** `sourceSpread` counts pages, publishers, the subjects' own pages, and outside publishers (each once). `sourceSpreadCaution` gives a sentence when fewer than two outside publishers back what the answer cites.
- **The writer sees each source's origin.** It is told that several of the subjects' own pages agreeing is one interested voice, and that pages which are only the subjects' own make it "medium" at most.
- **The page shows it** without a new component:
  - finding links are named for their publisher;
  - the caution leads **Still open**;
  - the Answer preset gains an Agenda part listing each publisher with its pages (`/notebook/sources`, `/notebook/sourceCautions`).
  - Pages saved before keep their parts, and their Still open and links change.
- **Old entries are not backfilled.** `evidenceOrigin` reads an origin from the address when none was stored.

## Consequences

- An answer built only from the subjects' own pages says so where its open questions are. The writer is steered away from calling it high.
- The confidence is still the writer's word. Capping it in code, from traced claims and independent publishers, is the next step, and so is having the check step trace an answer's findings to their pages. Both build on this origin.
- Telling subjects apart by name in the title can miss a subject named in plain words ("the sandwich"), and could match a short name inside an unrelated site. Names under three letters are skipped, and the finder's `whose` covers what the address can't.
