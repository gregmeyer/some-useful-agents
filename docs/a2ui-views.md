# A2UI views

> **Where views show:** the run page (Result), the agent's **Pulse** tile and named dashboards, inbox threads (under an action that ran the agent), and **agent chat** (each reply; clicks continue the conversation). A view takes the place of the agent's `signal` template and `outputWidget` wherever both exist. An agent with only a `view:` (no `signal:`) still gets a Pulse tile, titled with its name.

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

## What a view can bind to

Every view gets the same data model, built from the run:

| Path | What |
| --- | --- |
| `/outputs/<name>` | the agent's outputs (the last node's structured outputs, or the result parsed as JSON) |
| `/result` | the run's result text |
| `/inputs/<NAME>` | the inputs the run had |
| `/run/status`, `/run/startedAt`, `/run/completedAt`, `/run/durationMs`, `/run/costUsd` | facts about the run |
| `/history` | earlier runs, newest first: `[{ outputs, completedAt }]` (for trends) |
| `/data` | (generated views) the data the view brought with it |

A prop is either a literal (`text: "Weather"`) or bound (`value: { path: /outputs/temp }`). Lists repeat a template over an array: `children: { path: /outputs/items, componentId: row }`, where paths inside `row` without a leading `/` are relative to the item. See the [A2UI v0.9 spec](https://a2ui.org/specification/v0.9.1-a2ui/) for functions like `formatNumber` and `formatDate`.

## The sua catalog

The [A2UI basic catalog](https://a2ui.org/specification/v0.9.1-a2ui/) (Text, Image, Icon, Video, AudioPlayer, Row, Column, List, Card, Tabs, Modal, Divider, Button, TextField, CheckBox, ChoicePicker, Slider, DateTimeInput), plus:

| Component | Props | For |
| --- | --- | --- |
| `Metric` | `label`, `value`, `unit?`, `delta?`, `tone?` (neutral/ok/warn/err) | a big number |
| `Badge` | `text`, `tone?` | a status pill |
| `KeyValue` | `items` (array of `{label, value}`) | facts |
| `Table` | `rows` (array of objects), `columns: [{key, label, format?: text \| link}]` (1–12), `maxRows?`, `sortColumns?` + `defaultSort?` ("col" or "col desc"), `filterColumns?` + `filterPlaceholder?`, `pageSize?` | rows of results; sorting (click a header), filtering and paging happen in the browser |
| `Disclosure` | `label`, `child` (a component id), `open?` | a collapsible section |
| `Link` | `text`, `url` (http/https, or a dashboard path starting with `/`) | a link, opens in a new tab |
| `Code` | `text`, `language?` | preformatted text |
| `Sparkline` | `values` (array of numbers, or `{value}` objects), `label?`, `current?` | a small trend line |
| `Funnel` | `stages` (array of `{label, value}`, or a notebook's funnel: `{stage, reached, ruledOut, reasons}`) | decreasing stages; ruled-out counts and reasons when given |
| `OptionGrid` | `options` (array shaped like a notebook's options), `fields?`, `stages?`, `layout?` (grid / table), `sort?` ("price", a field key, "… desc"), `ruledOut?` (show / hide), `actions?`, `maxItems?` | candidates as cards (photo, rank, price, facts, stage, price move) or a table, with a Grid/Table switch; `actions` adds Move / Rule out, sent as `notebook-option` actions |
| `Scatter` | `points`, `x`, `y` (keys, dotted for nested), `xLabel?`, `yLabel?`, `xFormat?` / `yFormat?` (number / money), `xBand?` / `yBand?` (`{min, max}` to shade), `xBetter?` / `yBetter?` | items on two axes with your ranges shaded and the best one highlighted |
| `Columns` | `children`, `widths?` (e.g. `[3, 2]`), `align?` (stretch / start) | side by side with relative widths; stacks on a narrow screen; `start` lets each keep its own height |
| `Panel` | `title`, `note?`, `child` | a titled frame for a widget |
| `Callout` | `label?`, `text` (`**bold**` allowed), `next?` | a highlighted paragraph, e.g. "Where it stands" |
| `StatStrip` | `items` (`{label, value, tone?, sub?}`) | boxed stats in a row |
| `Steps` | `steps` (`{text, met, note?}`), `label?` | a progress ring and a path of steps |
| `Coverage` | `sources` (`{name, found, status: found / none / blocked / skipped, note?}`), `note?` | where a search looked |
| `Checklist` | `groups` (`{id, title, items: [{text, done}]}`), `actions?` | checkboxes; ticking sends a `notebook-option` check action |
| `Timeline` | `events` (`{at, title, body?, kind?, faded?, tag?, link?}`), `maxItems?` | events, newest first |
| `ChipList` | `items` (strings or `{text, tone?, title?}`) | short chips; warn chips stand out |
| `SanitizedHtml` | `html` | agent-written HTML, through sua's allowlist sanitizer |

If a **generated** view isn't valid on a run, the run page says why and shows the agent's `outputWidget` (or the raw output) instead; Pulse and chat show the reason. The A2UI renderer (about 330 KB) is only loaded on pages that show a view.

## Existing widgets are drawn with A2UI too

Agents' existing widgets (Pulse `signal` templates and `outputWidget`s) are drawn through the same renderer, without changing any agent. This is the default; **Settings → Appearance → Widget renderer** switches back to the previous renderer if a widget looks wrong. That fallback stays for one release and is then removed. A converter lays out the values the old renderers would show: slot mapping, field extraction and ai-template substitution + sanitizing all run on the server exactly as before, and the view only arranges them. Threshold and accent colours carry over to metrics.

| Converted | Still on the previous renderer |
| --- | --- |
| templates: metric, text-headline, status, comparison, key-value, story, table, time-series (Sparkline), funnel, image, text-image, media (images and video files); `widget` | media with a YouTube/Vimeo link (embedded) |
| widgets: key-value, raw, dashboard, ai-template; **interactive widgets** (a form for the agent's inputs and a Run button that runs it in place); **controls**: sort / filter / paginate (on the table, in the browser), view-switch (Tabs, default first), field-toggle (a collapsible section); preview fields (a link to the file) | diff-apply, action fields, table columns with href/text templates, array controls on ai-templates, the capture-image control |

**Every widget in the 44 example agents converts**: 26 of 26 Pulse templates and 22 of 22 output widgets. Anything not converted keeps drawing with the previous renderer, so nothing disappears. A widget with a `capture-image` control stays on the previous renderer (the PNG capture can't see inside A2UI components); a `copy` control works on A2UI widgets. The setting applies to the whole dashboard.

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

Outside chat (Pulse tiles, dashboards, the run page, inbox threads), a Button whose action is named `run-agent` runs an agent instead: its context is `{ agent: <id>, in_<INPUT>: <value>, … }` (usually bound to TextFields / ChoicePickers), and a tile refreshes in place when the run finishes.

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
