# Notebooks

A **notebook** is a goal you keep over time, like "Buy a used car" or "Find a new job". It holds:

- **what it's for**, in a sentence ("Find a reliable used SUV for family trips, and decide by Oct 15");
- **parameters**, the bounds it works within ("AWD", "under $26,000");
- **done when** criteria, ticked as they're met;
- a **pipeline**, the agents that gather for it, and how often they run;
- **entries**: options you're weighing, notes, evidence, and decisions, each with who added it;
- finally, **a decision** that closes it.

## Where to find them

There's no top-nav item yet. Notebooks show up:
- **on Home:** a Notebooks line under the goal ("1 active notebook · New notebook"), and each active notebook as an item in **Happening now** on Today, with its progress;
- **at `/notebooks`:** the list, with a ring showing criteria met, plus **New notebook**;
- **through sua:** ask "where's my used car goal?" or "what did I decide about the car?", and sua answers from your notebooks with a link.

## Talk to sua; it fills the notebook

You don't fill in a notebook by hand. A new notebook opens with **Tell sua what you're looking for**. Talk it through: who it's for, budget, must-haves, what you've seen or ruled out. The conversation opens beside the page in the sua drawer.

- **sua files what you say as you go**, and the page updates on its own:
  - preferences and context become **notes**;
  - specific candidates become **options**;
  - facts about them become **evidence**;
  - "skip anything with a salvage title" becomes a **ruled-out decision**;
  - limits and "done when" lines are added to the notebook's parameters and criteria.

  This follows your autonomy setting: under Full it applies right away, otherwise it waits as a card. Every entry can be removed.
- **sua suggests a pipeline** when there isn't one, from agents you have (e.g. a listings search every morning). That's a **Set up the pipeline** card you approve, and it can run once right away.
- **Agents sua runs in the conversation feed the notebook.** A search becomes options, evidence, or a note such as "Searched Seattle Craigslist for Foresters: nothing that fits yet", each linked to its run. When sua builds an agent for the notebook, it offers to add it to the pipeline.
- **New limits replace the ones they contradict** ("budget is now $3–6k" drops the old range).
- **The notebook keeps its conversation.** the page shows sua's latest message, **Continue the conversation** reopens it, and a conversation started from the notebook's page belongs to it. To add an entry yourself, open **Add an entry yourself**.

## A notebook's page

- **The cover** shows the title, status, what it's for, the parameters, and the cadence. The pipeline is drawn as connected agents, each with its last run (ran, failed, not run yet, not installed). A ring shows how many criteria are met; click a criterion to tick it.
- **Its sections** are drawn from the notebook's own surface (`notebook:<id>`; see [surfaces](surfaces.md)):
  - **Options**;
  - **Notes and decisions**, with decisions first;
  - **Evidence**.
- **Add to this notebook** adds a note, an option, evidence, or a decision.
- **Edit this notebook** changes the title, what it's for, parameters, criteria, pipeline (agent ids) and schedule. Editing the criteria keeps the ticks on the ones you didn't change.
- **Decide…** records what you decided and why. The decision is also kept as an entry, and the notebook closes. **Reopen** any time; **Stop** pauses a notebook without deciding.

## Option facts

Options record their facts as data, not only as text, so they can be compared, sorted and charted.

- **Each notebook has fields:** what every option records, e.g. price, miles, year, location and listing for a car; rent, sq ft and neighborhood for a flat. The keeper sets them the first time a run finds options. Each field has a type (money, number, text, link, image, date) and, optionally, a role. The roles are what let one widget work for any notebook:
  - `price`: what it costs;
  - `measure`: the main number to compare;
  - `place`;
  - `link`: the listing;
  - `image`;
  - `when`;
  - `org`: the company or seller, to group by.
- **Money and number fields say which way is better.** A price is better lower, a salary or a rating higher. Ranking and charts use it, and a `price` field is better lower unless the notebook says otherwise.
- **Ranges:** a money or number field can take a span ("$150k–$180k", shown as $150,000–$180,000). Sorting and charts use its midpoint.
- **Any kind of search fits.** For a car: price, miles, year, location, listing. For a job: salary (a range, better higher), company (`org`), commute, posted date, posting. For a product: price, rating (better higher), store (`org`), photo.
- **Options kept before the notebook had fields** get filled in from their text when the fields are set. Only unambiguous facts are read: a dollar amount, a number with the measure's unit, a leading year, a web address.
- **The same option is one entry.** Each option has a fingerprint: a VIN or listing id when the agent gives one, else its listing's address. When a later run finds it again, its facts are refreshed and the card says "seen again". It isn't added a second time.
- **On the page**, an option shows its facts as chips (the price highlighted) and its listing as a link.
- **For widgets:** `GET /notebooks/<id>/data.json` returns the notebook as data, the same shape for every notebook:
  - `limits`, `criteria`, `progress` and `fields`;
  - `options`, each with its facts by key, plus `price`, `measure`, `place`, `org`, `link` and `image` picked out by role (a range's midpoint for `price` and `measure`), and `firstSeenAt` / `lastSeenAt`;
  - `notes`, `evidence`, `decisions` and `history`.

## The pipeline

Under **Edit**, list the agents that gather for the notebook, one id per line, in order. **Run the pipeline now** runs them one after another. The diagram shows which agent is running, and the page updates as it goes.

- **Each agent gets the notebook's goal.** Any input it declares named `GOAL`, `NOTEBOOK`, `NOTEBOOK_CONTEXT` or `BRIEF` gets the statement, parameters and criteria. `TOPIC`, `QUERY`, `QUESTION` or `SEARCH` gets the statement. Other inputs keep their defaults.
- **The notebook keeper turns output into entries.** After each agent finishes, the keeper (a built-in sua agent, `notebook-keeper`) reads what it found against the notebook's goal, parameters, criteria and existing entries. It writes what's new:
  - **options** that fit the parameters;
  - **evidence** about them;
  - **notes**;
  - **ruled-out decisions** with the reason, e.g. "Ruled out: 2018 CR-V, over the mileage limit".
- **Nothing is added twice.** It skips anything whose title the notebook already has, and adds at most 12 entries per agent per run. An option it finds again (see [Option facts](#option-facts)) is updated instead.
- **Each entry links back** to the agent and run it came from.
- **Criteria:** if an agent's output clearly shows a criterion is met, the keeper ticks it and adds a "Met: …" note saying why. It doesn't tick on a guess.
- **The last run's summary** shows under the diagram, e.g. "8 new entries · listings: 8 new". A failed agent or a missing one is noted there too, and the rest of the pipeline still runs. A notebook runs one pipeline at a time.

## Coming next

- **G4:** one schedule for the notebook. Each run shows what's new or changed, and progress against the criteria.
- **G5:** "start a notebook to research X" from sua drafts the notebook, its pipeline and schedule behind one approval.
