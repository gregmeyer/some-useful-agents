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

- **The Notebooks page** lists them as cards (**+ New notebook** is at the top right). Each has a cover: the best kept picture among options still in the running (a listing photo first, then an example photo, then an illustration), or until there is one, a cover drawn for it in its own colour with an icon for what it's about (a car, a job, an instrument, a bike, a laptop, a home…) and its stages. Opening the page also starts finding pictures for options that have none. what it's for (or what you decided), the best price with its lead option, chips for options and how many are in the running, and how many done-whens are met. Tabs show **Active** (the default), **Decided**, **Stopped** or **All** with counts; search matches titles, goals, decisions and limits; sort by recently updated, newest or A–Z; 12 to a page.

## Talk to sua; it fills the notebook

**When you start a notebook, sua says hello first.** Once it has set the notebook up, it posts a message in the notebook's conversation:
- **First, the one most useful thing to tell it:** what the notebook is for, your limits, or any options you've already seen.
- **Then how it'll keep the notebook:** what it notes for each option, the stages, and what "done" means.

The conversation waits on your reply, so it's on Today. On the notebook page, the message shows under **Talk to sua**, and the big start box points there instead of offering a second place to type.

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

- **Enter sends** what you type in **Tell sua** (as in the drawer); **Shift+Enter** starts a new line, and **Cmd/Ctrl+Enter** sends too.

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

- **Each notebook has fields:** what every option records, e.g. price, miles, year, location and listing for a car; rent, sq ft and neighborhood for a flat.
- **sua sets them up for you,** along with the stages: in the background when you start a notebook (from its goal), when a notebook has options but no fields (the first time you open it, or right after sua files an option from your conversation), or the first time a search finds options. Setup gives options already in the notebook their facts, read from their text. While it runs, the page says "sua is setting up what to track…" and redraws when it's done; it's tried once per notebook. Each field has a type (money, number, text, link, image, date) and, optionally, a role. The roles are what let one widget work for any notebook:
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
- **Price history:** each time a search finds an option, what it said is kept. A card shows how the price moved since it was first seen ("↓ $123 since Oct 5"): green when it moved the way that's better (lower for a price, higher for a salary), amber otherwise.
- **Photos:** a notebook keeps a copy of each option's photo, so a card shows the actual car (or flat, or product), even after the listing is gone. After each search, and when you press **Get photos** on the Options heading, sua tries options that don't have one yet:
  - the option's image field (role `image`), when the search gave a photo address;
  - otherwise its listing page's own preview photo, but only when the address is one listing (it carries an id, not a page of results) and the page's title names the option (its year and model). A results page shows a generic picture, which would be the wrong car.

  Every photo is fetched with the same guards as web pages (no private or local addresses, every redirect checked) and must be a real JPEG, PNG, GIF or WebP of at most 3 MB; never SVG. The copy is kept in sua's database and served from your dashboard, so the page never loads from the seller's site. An address that didn't give a photo isn't tried again. Some sites block automated requests (AutoTrader serves a "page unavailable" page), and results-page links give no photo, so the most reliable source is a search agent that returns each listing's own link and photo address.
- **Representative pictures:** an option still without a photo (the listing gave none, or blocked the request) gets a **representative** one: sua's `notebook-picture` agent searches for a picture of what it is (a Wikimedia photo of that model and generation, the product's image, the company's logo), and always draws a simple **SVG illustration** too, used when no image can be fetched. Found images go through the same guarded fetch (large Wikimedia originals are fetched as 500px thumbnails); drawings are rebuilt from an allowlist of plain shapes (no scripts, styles, links or embedded content) and served as an image under a sandbox CSP. Cards label them **example photo** or **illustration**, so they're never mistaken for the real one. This runs after each search, from **Get photos**, and when you open a notebook with options that have none; each option is tried once, and ruled-out ones are skipped.
- **Not seen lately:** each search is recorded, along with how many options it found. When the last 2 searches by the agent that found an option found other options but not this one, its card says "not in the last 2 searches". It may be sold, filled or taken down. A search that found nothing doesn't count, since web search results vary from run to run. Being found again clears it.
- **For widgets:** `GET /notebooks/<id>/data.json` returns the notebook as data, the same shape for every notebook:
  - `limits`, `criteria`, `progress` and `fields`;
  - `options`, each with its facts by key, `priceHistory` and `priceChange`, `missedSearches` and `notSeenLately`, plus `price`, `measure`, `place`, `org` and `link` picked out by role, `image` (the kept photo's address on your dashboard) and `imageSource` (where it came from) (a range's midpoint for `price` and `measure`), and `firstSeenAt` / `lastSeenAt`;
  - `notes`, `evidence`, `decisions` and `history`.

## Widgets

Once a notebook has fields and options, its page is drawn as A2UI widgets (see [A2UI views](a2ui-views.md)), the same for a car, a job or a product:

- **Where it stands:** a short paragraph (how many are in the running, the best lead and the next best, the furthest stage) with **Next:**, e.g. "check still listed and clean title on the top two before you contact anyone". Beside it, **Done when** shows a progress ring and the steps, with the current one highlighted.
- **Stats:** in the running, best price (or pay), furthest along, ruled out.
- **Where they sit:** price against the main measure (miles, sq ft, commute). Your limits are shaded, the best lead in the running is highlighted, and ruled-out options are hollow. **How far they got** shows the funnel per stage, with ruled-out counts (hover for why).
- **Shortlist:** cards (photo or "No photo yet", rank, a short name, price, facts, stage, price move) or a table. Ruled-out options are **hidden by default**; **Show ruled out (N)** brings them back, and your choice is remembered in this browser. Each card has **Listing ↗**, **<next stage> →** and **Rule out…**, whose first choice is **No longer available** (sold, filled, out of stock), followed by quick reasons or your own words. "Not seen lately" cards also offer **Mark gone**.
- **Before you decide** (a third of the row): a checklist for the top two (the notebook's checks, e.g. Still listed, Clean title). Tick boxes right there.
- **How we got here** (two thirds): a timeline of searches (with which sites they reached), notes, decisions, moves and rulings, newest first.
- **Where sua looked:** the latest search's sites: how many it found on each, and which were blocked or skipped. **Limits:** your limits, with ones that disagree (two different budgets, two mileage ranges) flagged.

A notebook without fields shows cards instead. The widgets bind to the notebook's data (`/notebook/...`, the same as `data.json`), so they can be rearranged or placed on a board later.

**No longer available** is not a ruling: the option leaves the running and reads "No longer available", not your reason. Tell sua too ("the RAV4 sold", "they filled the Stripe role").

**Facts are checked against the option's own text.** If a fact sua records for an option contradicts the year, price or measure its text states (a model can mix up two options), the text wins. Facts stored before this check are repaired when you open the notebook. Fields without a role get the one their name implies (`price`, `miles` in mi, `listing_url`, `photo`, `location`, `seller`).

## Stages and ruling out: the funnel

Options move through the notebook's **stages** toward a decision, and you can rule any of them out.

- **Each notebook has stages,** e.g. Found → Checked → Test drive → Offer → Bought for a car, or Found → Applied → Screen → Interview → Offer for a job. The keeper proposes them along with the fields; you can change them under **Edit** (one per line). New options start at the first stage. If you remove a stage, its options move to the first one.
- **Move an option along** with **Move to <next stage> →** on its card, or tell sua ("I applied to Stripe and Plaid", "we test-drove the RAV4").
- **Rule an option out** with **Rule out…**: pick a quick reason (Not interested, Too expensive, No reply, Failed a check) or write your own. Or tell sua ("rule out the XT, too pricey", "no callback from Plaid").
  - A ruled-out option **stays in the notebook,** dimmed and at the end of its section, showing where it was ruled out and why: "Ruled out at Applied: no callback". **Bring back** undoes it, and so does moving it to a stage.
  - **Ruled out stays ruled out.** When a search finds the same option again (same fingerprint), it isn't suggested again. The keeper also sees why options were ruled out and skips others that fail for the same reason. When three or more are ruled out for one reason, sua offers to make it a limit.
- **The funnel** above the options shows how many reached each stage and how many were ruled out there ("4 Found −2 → 1 Checked → 1 Test drive"); hover for the reasons.
- **In conversation, sua can also tick a done-when criterion** when what you said shows it's met ("the title's clean").
- `data.json` includes `stages`, a `funnel` (per stage: reached, here now, ruled out, top reasons), each option's `stage`, `stageIndex` and `ruledOut`, and `active` / `ruledOutCount`.

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
