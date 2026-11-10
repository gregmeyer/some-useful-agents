# ADR-0071: Notebooks have topic tags, and who they're about is kept apart

- Status: accepted
- Date: 2026-11-10
- Deciders: Greg Meyer
- Builds on: ADR-0053 (notebook templates), ADR-0057 (a template's subject)

## Context

A notebook had nothing that said what it was about except its words. The Notebooks list matched a search against titles, goals, decisions and limits, so with thirty notebooks (most archived, several run again under the same title) finding "the job searches" meant reading cards. And when you asked for a new notebook, nothing checked whether one like it existed: sua could not tell "this again" from "this kind of thing, for someone else".

Both need the same thing: a small, stable description of a notebook that can be compared with another notebook or with a request.

## Decision

1. **Topic tags, written by an agent, in one JSON column.** `notebooks.tags_json` holds `{ auto, added, removed, subject, key, at, failedAt }`. `auto` is two to four tags from the `notebook-tagger` system agent. `added` and `removed` are the user's and always win: the tags shown are `auto` minus `removed`, plus `added` (`notebookTags`). A re-tag replaces `auto` only.
2. **Tagged in batches, with the tags already in use.** The tagger gets up to 20 notebooks a run and the 40 most used tags, and is told to reuse one whenever it fits. Seeing a batch together and seeing the vocabulary is what keeps "used cars" from becoming "second-hand cars" next week. There is no fixed list of tags.
3. **Stale by a key, not by hooks.** `key` is a hash of the title, goal and limits. A notebook is tagged when it has never been, or its key differs. Nothing listens for edits: the list opening or a notebook being made starts the tagger, which reads what is stale. Steps are not in the key, because they are laid out seconds after a notebook is made and would tag every new notebook twice. A failed try waits a day.
4. **Tags name the topic only. Kind and subject are separate.** A tag never names the kind of notebook ("meeting", "shortlist") or a person or company. The kind is derived from the page and steps a notebook already has, so it is not stored. Who or what it is about is `subject`: the tagger copies it word for word from the title or goal, and it is kept only when those words are really there. That is the part that changes when you do the same kind of notebook for someone else.
5. **Tagging is not a change to the notebook.** Writing tags leaves `updated_at` alone, so the list's order and "updated 2d ago" stay true.
6. **A notebook run again keeps its tags**, the user's changes included, and is not tagged again (same title, goal and limits: same key).

## Consequences

- The list filters by one tag at a time (`?tag=`), and search matches tags and the subject. Card chips are not links: the whole card is one link, so filtering is from the row above the grid.
- Tags can still drift over months; there is no tool to merge two tags or rename one. Removing a tag on one notebook and adding another (Edit → Tags) is the only correction.
- The subject and the derived kind are what a later change uses to tell "you already have this notebook" (same topic, same subject) from "set it up like that one" (same kind, another subject) when you ask for a new notebook.
- Tags cost one short model run per 20 notebooks, once, and one per changed notebook after that.
