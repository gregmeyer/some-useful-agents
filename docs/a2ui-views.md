# A2UI views

> **Status:** the schema, catalog and validation are in place (W1). Rendering views on the run page, Pulse and in chat lands next (see the plan in the changelog / ROADMAP). Until then a `view:` is validated and stored but the dashboard keeps drawing the agent's existing widget.

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
| `Table` | `rows` (array of objects), `columns: [{key, label, format?: text \| link}]` (1–12), `maxRows?` | rows of results |
| `Link` | `text`, `url` (http/https) | a link, opens in a new tab |
| `Code` | `text`, `language?` | preformatted text |
| `SanitizedHtml` | `html` | agent-written HTML, through sua's allowlist sanitizer |

## Validation

Every view, declared or generated, is checked the same way:

1. At most 200 components and 64 KB.
2. The A2UI message processor in **strict** mode against the sua catalog (the same code the browser renderer runs): only known components, every prop checked against its schema (unknown props are rejected), exactly one `root`, no references to missing components, nothing unreachable from `root`, bounded depth.
3. sua's own checks: a literal `Image` url must be https from a host in the agent's `permissions.imgSrc` (or a `data:` URL); a literal `Link` url must be http(s). Bound urls are checked when the view is drawn.

A declared view is checked when the agent is saved or imported (an invalid one is refused, with the reason). A generated view is checked on every run; if the node's output isn't a valid view, the widget shows why instead of the output.

See [ADR-0047](adr/0047-a2ui-views.md) for the design.
