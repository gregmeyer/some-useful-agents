# A2UI views

> **Where views show:** the run page (Result), the agent's Overview (**Latest result**), its **Pulse** tile and named dashboards, inbox threads (under an action that ran the agent), and **agent chat** (each reply; clicks continue the conversation). A view takes the place of the agent's `signal` template and `outputWidget` wherever both exist. An agent with only a `view:` (no `signal:`) still gets a Pulse tile, titled with its name.

An agent can describe how its results look as an [A2UI](https://a2ui.org) view: a list of UI components (text, cards, rows, metrics, tables, buttons…) bound to the data each run produces. A2UI is an open, declarative format: no code, only components from a known catalog, so it's safe to render even when a model wrote it.

There are two kinds:

```yaml
# Declared: the shape is fixed in the YAML; each run fills in the data.
view:
  components:
    - { id: root, component: Card, child: body }
    - { id: body, component: Column, children: [title, temp, hours] }
    - { id: title, component: Text, text: "Weather", variant: h3 }
    - { id: temp, component: Metric, label: Now, value: { path: /outputs/temp }, unit: "°C" }
    - id: hours
      component: Table
      rows: { path: /outputs/hours }
      columns: [{ key: time, label: Time }, { key: summary, label: Forecast }]
```

```yaml
# Generated: a node writes the view itself, so the shape can change per run.
view:
  from: design        # this node's output is the component list
```

A generated view's node outputs `<a2ui>…</a2ui>` around JSON (or a ```json fence, or bare JSON). The JSON is either the component list or `{ "components": [...], "data": {...} }`; `data` is extra data the view can bind to at `/data`.

## The View editor

Settings → Where it shows → **View** opens `/agents/<id>/view`: the view as YAML on the left, drawn on the right with the agent's last completed run (and its earlier runs, for trends) as you type. Mistakes show under the text and turn Save off. **Save as vN** stores it as the agent's `view:` in a new version (roll back from Versions); **Remove view** goes back to the output widget or plain text.

An agent without a view starts from one built from what its last run output (`starterView`): numbers as metrics, with a trend line when there are earlier runs; short text as labelled lines; lists of objects as tables (web addresses as links); lists of words as chips; long text as a paragraph. Labels come from the old output widget's fields where it had them. **Start from its outputs** puts that starter back. Below the editor, **What it can bind to** lists every path with its value from the last run, and **sua components** lists the catalog with an example of each.

**Redesign with sua.** At the top of the View editor (or from **✎** on a board tile), say what should change, or nothing, and press **Redesign**. sua's `view-designer` agent gets the current view (or the starter), a trimmed sample of the last run's data (lists cut to 5, text to 300 characters), the component catalog and your [brand](brand.md) guide, and proposes a view with a one-line reason. It's validated like any view; when it isn't valid, sua tries once more, told what was wrong. The page shows **Now** and **Proposed** side by side, drawn with the same run: **Use this** saves it as a new version (roll back from Versions), **Edit it first** puts it in the editor unsaved, **Discard** drops it, and **Ask for something different** tries again. One proposal per agent at a time; it's kept in `.sua/view-proposals/` until you use or discard it.

When a step's only output is `result` and it holds a JSON object (a step that printed JSON), that object's fields are outputs too: `/outputs/articles`, alongside `/outputs/result`.

## What a view can bind to

Every view gets the same data model, built from the run:

| Path | What |
| --- | --- |
| `/outputs/<name>` | the agent's outputs (the last node's structured outputs, or the result parsed as JSON) |
| `/result` | the run's result text |
| `/inputs/<NAME>` | the inputs the run had |
| `/run/status`, `/run/startedAt`, `/run/completedAt`, `/run/durationMs`, `/run/costUsd` | facts about the run |
| `/history` | the agent's earlier completed runs, newest first (up to 29): `[{ outputs, completedAt }]` |
| `/series/<name>` | each numeric output as a list of numbers, oldest first, ending with this run (up to 30); `"1,200"` and `"$4.50"` count as numbers. Bind a `Sparkline`'s `values` here |
| `/agent/id`, `/agent/name` | the agent the view belongs to |
| `/data` | (generated views) the data the view brought with it |

Earlier runs are read only when a declared view mentions `/history` or `/series` (and for every generated view).

```yaml
view:
  components:
    - { id: root, component: Column, children: [trend, again] }
    - { id: trend, component: Sparkline, label: Stars, values: { path: /series/stars }, current: { path: /outputs/stars } }
    - { id: again, component: Button, child: again_label, action: { event: { name: run-agent, context: { in_REPO: { path: /inputs/REPO } } } } }
    - { id: again_label, component: Text, text: Run again }
```

**Run buttons.** A `Button` whose action is `run-agent` runs the view's own agent: in place on a board tile, and elsewhere it starts the run and opens it. Inputs travel in the context as `in_<NAME>` (a literal or one binding each). The action always targets the view's agent, whatever `context.agent` says, so a view can't start another agent. In the agent chat, any action (this one included) becomes your next message instead.

A prop is either a literal (`text: "Weather"`) or bound (`value: { path: /outputs/temp }`). Lists repeat a template over an array: `children: { path: /outputs/items, componentId: row }`, where paths inside `row` without a leading `/` are relative to the item. See the [A2UI v0.9 spec](https://a2ui.org/specification/v0.9.1-a2ui/) for functions like `formatNumber` and `formatDate`.

## The sua catalog

The [A2UI basic catalog](https://a2ui.org/specification/v0.9.1-a2ui/) (Text, Image, Icon, Video, AudioPlayer, Row, Column, List, Card, Tabs, Modal, Divider, Button, TextField, CheckBox, ChoicePicker, Slider, DateTimeInput), plus:

| Component | Props | For |
| --- | --- | --- |
| `Metric` | `label`, `value`, `unit?`, `delta?`, `tone?` (neutral/ok/warn/err) | a big number |
| `Badge` | `text`, `tone?` | a status pill |
| `KeyValue` | `items` (array of `{label, value, url?, note?}`) | facts; `url` links the value, `note` is a short line under it (a source, a quote) |
| `Table` | `rows` (array of objects), `columns: [{key, label, format?: text \| link, linkText?}]` (1–12; a link column shows the row field `linkText` names as its text, else the agent id / "run ab12cd34" for a dashboard path or the address without `https://`; a cell may also be `{label, url}`), `maxRows?`, `sortColumns?` + `defaultSort?` ("col" or "col desc"), `filterColumns?` + `filterPlaceholder?`, `pageSize?` | rows of results; sorting (click a header), filtering and paging happen in the browser |
| `Disclosure` | `label`, `child` (a component id), `open?` | a collapsible section |
| `Link` | `text`, `url` (http/https, or a dashboard path starting with `/`) | a link, opens in a new tab |
| `Code` | `text`, `language?` | preformatted text |
| `Sparkline` | `values` (array of numbers, or `{value}` objects), `label?`, `current?` | a small trend line |
| `Funnel` | `stages` (array of `{label, value}`, or a notebook's funnel: `{stage, reached, ruledOut, reasons}`) | decreasing stages; ruled-out counts and reasons when given |
| `OptionGrid` | `options` (array shaped like a notebook's options), `fields?`, `stages?`, `layout?` (grid / table), `sort?` ("price", a field key, "… desc"), `ruledOut?` (show / hide), `actions?`, `maxItems?`, `filters?` (field keys or `stage` / `seen`, as a key or `{key, label}`, up to 8) | candidates as cards (photo, rank, price, facts, stage, price move) or a table, with a Grid/Table switch; `actions` adds Move / Rule out, sent as `notebook-option` actions. Each filter is a row of chips for the values the options have (hidden when they all agree, when no two options share a value, or when the values are sentences averaging over 32 characters; `stage` and `seen` always show); a chip's count is what picking it would show, given the other filters. Ranks and the best stay those of the whole list, and the choice is remembered per page in the browser. An option's `facets` (`{key: label}`) replaces a fact's value with a short label for its chip (`""` = not labelled yet, no chip); notebooks fill it from the `notebook-facets` agent |
| `Scatter` | `points`, `x`, `y` (keys, dotted for nested), `label?`, `href?`, `xLabel?`, `yLabel?`, `xFormat?` / `yFormat?` (number / money), `xBand?` / `yBand?` (`{min, max}` to shade), `xBetter?` / `yBetter?` | items on two axes with your ranges shaded and the best one highlighted. Hover or tap a dot (or focus the chart and use the arrow keys) for a note: its name, both values in full, and where it stands (best, its stage, ruled out and why, outside your limits). The `label` key names each dot. `href?` is the key of each dot's link (a path on this dashboard; other addresses are ignored): a click opens it, Cmd/Ctrl-click in a new tab, Enter opens the focused dot, and on a touch screen the first tap shows the note with **Open →** |
| `Columns` | `children`, `widths?` (e.g. `[3, 2]`), `align?` (stretch / start) | side by side with relative widths; stacks on a narrow screen; `start` lets each keep its own height |
| `Panel` | `title`, `note?`, `child` | a titled frame for a widget |
| `Callout` | `label?`, `text` (`**bold**` allowed), `next?` | a highlighted paragraph, e.g. "Where it stands" |
| `StatStrip` | `items` (`{label, value, tone?, sub?}`) | boxed stats in a row |
| `Steps` | `steps` (`{text, met, note?}`), `label?` | a progress ring and a path of steps |
| `Coverage` | `sources` (`{name, found, status: found / none / blocked / skipped, note?}`), `note?` | where a search looked |
| `Checklist` | `groups` (`{id, title, items: [{text, done}]}`), `actions?` | checkboxes; ticking sends a `notebook-option` check action; a group with an empty title has no heading |
| `Timeline` | `events` (`{at, title, body?, kind?, who?, faded?, tag?, link?}`), `maxItems?`, `filters?`, `search?` (default on past 8 events) | events, newest first; the same event again in a row folds into one row (×N, expandable) |
| `ProfileCard` | `name`, `role?`, `org?`, `about?`, `image?`, `links?` (web addresses or `{label, url}`), `asOf?` | who a person or company is: picture or initials, a role and org line, a one-liner, link chips |
| `FactSheet` | `facts` (`{label, value, url?, at?, estimate?, group?}`), `missing?` (strings) | facts under their groups, each with its source ↗ and date; estimates marked ≈; "Not found:" lists the rest |
| `QuoteList` | `items` (`{quote, title?, href?, source?, sourceText?, at?, ask?, group?, chosen?}`), `grouped?` (default on), `maxItems?` (default 4), `search?` (default on past 8) | what someone said, grouped, each with its source, date and an "Ask" line; Show N more |
| `Agenda` | `points` (strings or `{text, note?, refs?: [{label, href}]}`), `questions?`, `maxQuestions?` (default 3), `watch?` (strings or `{text}`), `title?`, `check?`, `copy?` | numbered talking points you tick off (ticks kept in this browser), questions to ask, things to watch for, and Copy as text |
| `NotebookHeader` | `cover?` (lead / none), `subtitle?`, `statement?`, `steps?` (show / fold), `side?` (a component id) | notebook pages only: how the page's own header looks (see notebooks.md); draws nothing itself |
| `ChipList` | `items` (strings or `{text, tone?, title?}`) | short chips; warn chips stand out |
| `SanitizedHtml` | `html` | agent-written HTML, through sua's allowlist sanitizer |

If a **generated** view isn't valid on a run, the run page says why and shows the agent's `outputWidget` (or the raw output) instead; Pulse and chat show the reason. The A2UI renderer (about 330 KB) is only loaded on pages that show a view.

## Who writes views

You, in the View editor; sua, with **Redesign**; and the agents that write agents: new agents from Build from a goal, New board and sua's fixes get a `view:` instead of an `outputWidget` (see [Build from a goal § How new agents look](build-from-goal.md#how-new-agents-look)). In a conversation, "make this tile better" or "show a trend for the price agent" starts a redesign (a `view-redesign` action, which runs without approval since nothing changes until you use the proposal) and replies with the link to compare.

## Existing widgets are drawn with A2UI too

Agents' existing widgets (Pulse `signal` templates and `outputWidget`s) are drawn through the same renderer, without changing any agent. A converter lays out the values the old renderers would show: slot mapping, field extraction and ai-template substitution + sanitizing all run on the server exactly as before, and the view only arranges them. Threshold and accent colours carry over to metrics.

| Converted | Still on the previous renderer |
| --- | --- |
| templates: metric, text-headline, status, comparison, key-value, story, table, time-series (Sparkline), funnel, image, text-image, media (images and video files); `widget` | media with a YouTube/Vimeo link (embedded) |
| widgets: key-value, raw, dashboard, ai-template; **interactive widgets** (a form for the agent's inputs and a Run button that runs it in place); **controls**: sort / filter / paginate (on the table, in the browser), view-switch (Tabs, default first), field-toggle (a collapsible section); preview fields (a link to the file) | diff-apply, action fields, table columns with href/text templates, array controls on ai-templates, the capture-image control |

**Every widget in the 44 example agents converts**: 26 of 26 Pulse templates and 22 of 22 output widgets. Anything not converted keeps drawing with the previous renderer, so nothing disappears. A widget with a `capture-image` control stays on the previous renderer (the PNG capture can't see inside A2UI components); a `copy` control works on A2UI widgets.

## In chat: replies are widgets, clicks are messages

On the agent's **Chat** tab, each reply whose run produced a valid view shows the view instead of the raw text ("Show the raw reply" keeps the text one click away). A Button (or any component with an `action`) continues the conversation when clicked: the action becomes your next message, either its `context.message` or "▸ name (key: value, …)".

```yaml
- id: choices
  component: Row
  children: { path: /outputs/followups, componentId: choice }   # one button per follow-up
- id: choice
  component: Button
  child: choiceLabel
  action: { event: { name: followup, context: { message: { path: label } } } }
- { id: choiceLabel, component: Text, text: { path: label } }
```

**Widgets inside any reply.** On the dashboard's Chat tab, every agent (with or without a `view:`) is told it may add a widget to its reply when that helps: several numbers, a comparison, a list of items with the same fields, choices to pick from. It writes `<a2ui>{"components": [...], "data": {...}}</a2ui>` between its words, binding values under `/data`. While the reply streams, the widget is drawn as each component is complete (parts not written yet show as "…"), then once more with its data when the block closes; the saved reply draws it in place of the block. Each component is checked like any view; one that doesn't check out shows as a short note while the rest of the widget is drawn, and a block that can't be read at all says so with its source one click away. The same conversation opened in the sua panel (⌘K) or on Home works the same way: a reply typed there goes to the agent (not sua), streams in, and its widgets build up as they're written. The history the agent sees next turn says "(a widget)" instead of the JSON. The CLI and MCP don't draw widgets, so agents aren't told about them there. Streaming needs a provider that streams (Claude); others send the reply in one piece.

**Widgets in sua's replies.** sua writes widgets the way chat agents do, from the same component list (core `replyWidgetComponents`), so a conversation looks and works the same whoever answers ([ADR-0047](adr/0047-a2ui-views.md#amendment-2026-10-14-one-reply-format-for-every-conversation)). In a conversation with sua (Home, the sua panel, a notebook's or an option's talk box, an inbox thread), sua adds an optional `widget` ({components, data}) next to `recommendation` in its plan when the answer has several numbers, compares a few things or lists items that share fields, or when it asks a question with a few likely answers: a Row of Buttons, one per answer, whose `context.message` is that answer ("This weekend, Oct 17–18"). The widget is checked the same way (a part that doesn't check out becomes a note; an unreadable one is dropped) and kept in the reply as an inline `<a2ui>` block, exactly as an agent's reply keeps it. It's drawn while sua writes it, then in place in the saved reply. Clicking a Button sends its message as your reply, and once you've replied its buttons are spent (the one you picked reads "✓ …"). Buttons answer; `links` take you somewhere; proposed actions run something. Replies saved before this (their widget in the reply's meta) still draw under the text.

Outside chat (Pulse tiles, dashboards, the run page, inbox threads), a Button whose action is named `run-agent` runs an agent instead: its context is `{ in_<INPUT>: <value>, … }` and it always runs the view's own agent (usually bound to TextFields / ChoicePickers), and a tile refreshes in place when the run finishes.

The click travels over the chat WebSocket like a typed message (see [conversations.md](conversations.md)), so the reply streams the same way.

## Validation

Every view, declared or generated, is checked the same way:

1. At most 200 components and 64 KB.
2. The A2UI message processor in **strict** mode against the sua catalog (the same code the browser renderer runs): only known components, every prop checked against its schema (unknown props are rejected), exactly one `root`, no references to missing components, nothing unreachable from `root`, bounded depth.
3. sua's own checks: a literal `Image` url must be https from a host in the agent's `permissions.imgSrc` (or a `data:` URL); a literal `Link` url must be http(s). Bound urls are checked when the view is drawn (links: http(s) only, enforced by the component; images: the page's CSP only allows hosts from `permissions.imgSrc`).
4. `SanitizedHtml` is resolved and sanitized **on the server** before the view is sent: the browser only ever receives allowlisted HTML as a literal. Binding it to a path inside a list item isn't supported (it would have to be resolved in the browser), so it shows a note instead.

Text supports a small, safe markdown subset (`**bold**`, `*italic*`, `` `code` ``, line breaks); everything else is shown as text.

A declared view is checked when the agent is saved or imported (an invalid one is refused, with the reason). A generated view is checked on every run; if the node's output isn't a valid view, the run page says why and falls back to the agent's output widget (or the raw output), and Pulse and chat show the reason. The model's output is never drawn unchecked.

See [ADR-0047](adr/0047-a2ui-views.md) for the design.

The catalog also holds five board-only components (`Section`, `Grid`, `Cell`, `AgentTile`, `SystemTile`) that lay out [canvas boards](boards.md#the-board-document). An agent's view can't use them.
