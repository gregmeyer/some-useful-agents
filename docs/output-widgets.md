# Output widgets

An **output widget** is a declarative renderer for an agent run's output. Instead of showing the raw stdout, the agent declares a schema — a widget type plus a list of fields (or an HTML template) — and the dashboard uses it to render a structured, often colorful, result panel.

Widgets appear in two places:

1. On the **agent detail page** (`/agents/<id>`), at the top of the most recent run's output
2. On **Pulse**, when the signal's template is set to `widget` (the tile mirrors whatever the agent's outputWidget renders)

This page is the reference. For how to edit a widget in the dashboard, see the [Dashboard tour](dashboard.md#output-widget-editor).

## Quick mental model

```
agent run → stdout/JSON → extractor → renderer → HTML
                         (by field   (per widget
                          name)       type)
```

**Fields** are extracted from the run output by name. sua looks in two places:

1. **XML tags:** `<headline>Big news</headline>` in the run output → `headline = "Big news"`
2. **JSON keys:** `{"headline": "Big news", ...}` at the top level (or nested — a deep search kicks in if the top-level miss) → same

If neither finds the name, the field renders as empty.

## Widget types

sua ships 5 widget types. Pick based on the shape of your output.

| Type | Best for | Layout |
|---|---|---|
| [`raw`](#raw) | Text-heavy output (reports, logs) | Titled sections, one per field |
| [`key-value`](#key-value) | Summaries (counts, statuses) | Definition list: `Label: Value` pairs |
| [`diff-apply`](#diff-apply) | Review/approve workflows | Classification pill + diff + action buttons |
| [`dashboard`](#dashboard) | KPI scorecards | Hero metrics + stats row + text sections |
| [`ai-template`](#ai-template) | Anything custom | An LLM-generated HTML template, sanitized |

### raw

Each declared field becomes a titled section. Suitable for agents that emit several chunks of prose or structured text. The most permissive type.

```yaml
outputWidget:
  type: raw
  fields:
    - { name: headline, type: text }
    - { name: summary, type: text }
    - { name: log, type: code }
    - { name: output_path, type: preview }  # renders a file inline
```

**Compatible field types:** `text`, `code`, `badge`, `preview`.

### key-value

Renders each field as `Label: Value`. Keep fields short and numeric where possible. Ideal for test-result summaries, counts, status rollups.

```yaml
outputWidget:
  type: key-value
  fields:
    - { name: total, type: text, label: "Total" }
    - { name: passed, type: text, label: "Passed" }
    - { name: failed, type: badge, label: "Failed" }
```

**Compatible field types:** `text`, `badge`.

### diff-apply

Specialized for review/approve workflows. Expects specific field names so the renderer knows what to put where. Used by the bundled [`agent-analyzer`](../agents/examples/agent-analyzer.yaml).

```yaml
outputWidget:
  type: diff-apply
  fields:
    - { name: classification, type: badge }   # rendered as the pill
    - { name: summary, type: text }
    - { name: details, type: code }           # the diff body
  actions:
    - id: apply
      label: "Apply"
      method: POST
      endpoint: "/agents/{agentId}/apply"
      payloadField: details
```

**Compatible field types:** `text`, `code`, `badge`, `action`. Field names `classification`, `summary`, `details` are load-bearing for layout. Actions become POST buttons.

### dashboard

Hero metrics on top (big numbers), compact stats row below, text sections beneath. Use for run scorecards and KPI summaries.

```yaml
outputWidget:
  type: dashboard
  fields:
    - { name: primary_kpi, type: metric, label: "Primary" }
    - { name: secondary_kpi, type: metric, label: "Secondary" }
    - { name: total, type: stat }
    - { name: passed, type: stat }
    - { name: failed, type: stat }
    - { name: notes, type: text }
```

**Compatible field types:** all of them. Order matters inside each row (metrics first, then stats, then text/code/preview).

### ai-template

**New in v0.18.** Instead of declaring fields by name, you describe the layout in plain English. Claude generates a sanitized HTML template. The template is stored on the widget and re-rendered against every run's output at display time.

```yaml
outputWidget:
  type: ai-template
  prompt: |
    A card with the run score as a big hero metric, a status pill beneath it,
    and an inline SVG sparkline showing the last 7 results.
  template: |
    <div class="report-card">
      <div class="hero">{{outputs.score}}</div>
      <span class="pill">{{outputs.status}}</span>
      <svg viewBox="0 0 100 30">...</svg>
    </div>
  fields: []   # optional — the renderer auto-detects placeholders from the template
```

In practice you don't hand-author `template:` — you write `prompt:` in the editor, click **Generate**, and Claude returns HTML. Every `{{outputs.NAME}}` placeholder the LLM emits gets extracted from the run's output using the same extractor described above.

See the [AI template workflow](#ai-template-workflow) below for the full loop.

## Field types

| Type | Renders as | Valid in |
|---|---|---|
| `text` | Plain paragraph (wraps, respects whitespace) | all |
| `code` | Monospaced preformatted block | raw, diff-apply, dashboard |
| `badge` | Inline pill (color by value or tag-name heuristic) | all |
| `action` | POST button wired to widget `actions[]` | diff-apply only |
| `metric` | Hero number + label (rendered large) | dashboard only |
| `stat` | Compact stat card in a grid row | dashboard only |
| `preview` | Iframe for HTML paths, `<img>` for images | raw, dashboard |

Types outside a widget's "Valid in" column are allowed but have no visual effect — the editor dims them with `(n/a)` to guide you.

## AI template workflow

When a user picks the `ai-template` card at `/agents/:id/config`:

1. **Write a prompt** — describe the visual shape ("card with hero metric, status pill, sparkline"). Mention field names if you have them; the editor also tries to infer from the agent's declared fields.
2. **Click Generate** — dashboard POSTs to `/agents/:id/output-widget/generate`. The server spawns `claude --print` with a strict system prompt (HTML body only, allowlisted tags, `{{outputs.NAME}}` placeholders). A modal with a spinner + elapsed-seconds counter shows progress; Cancel aborts the subprocess.
3. **Server sanitizes** — returned HTML runs through the tag/attr allowlist. Anything outside the allowlist (scripts, iframes, on-handlers, javascript: URLs) is stripped. Sanitized HTML is returned to the browser.
4. **Edit the template** — the textarea is editable. Hand-tune colors, move elements around, etc.
5. **Preview** — a live preview card under the editor rerenders on every edit, using synthetic sample data (`sample headline`, `42`, `ready`, etc.) for each placeholder.
6. **Save** — the save route re-sanitizes (defense-in-depth) and persists the template on the widget row.

At run time, `renderAiTemplate()`:

1. Walks the template, pulling every `{{outputs.NAME}}` placeholder
2. Extracts each value from the run output (XML tag or JSON key — same extractor)
3. Substitutes, **HTML-escaping each value** so a run can't inject its own HTML
4. Runs the whole result through the sanitizer once more
5. Wraps in a `<div class="ai-template-widget">` container and renders

## Security

- **Templates are trusted at save time.** Whoever can save an agent can save an HTML template. The sanitizer is the safety net, not access control.
- **Values from run output are always HTML-escaped** before substitution, then the whole substituted string is re-sanitized. Two-layer defense.
- **Allowlist lives in core** — [packages/core/src/html-sanitizer.ts](../packages/core/src/html-sanitizer.ts). Full list of allowed tags + attrs is documented there.
- **SVG preserved** — the allowlist includes SVG shapes and presentation attrs (`viewBox`, `fill`, `stroke`, etc.) so generators can emit inline charts.
- **`on*` handlers, `<script>`, `<iframe>`, `<form>`, `javascript:` URLs are always dropped.** `data:image/*` is allowed; other `data:` URLs are not.

See [Security → HTML sanitizer](SECURITY.md#html-sanitizer-v018) for the full treatment.

## Starter templates

The editor ships with 5 one-click starter widgets under the **Load example** dropdown:

| Key | Widget type | Field shape |
|---|---|---|
| Report card | dashboard | headline (metric) + body (text) + status (badge) |
| Metric dashboard | dashboard | 2 metrics + 3 stats |
| File preview | raw | single `output_path` preview field |
| Diff applier | diff-apply | classification + summary + details |
| Key-value summary | key-value | total + completed + failed |

Pick one, tweak the field names to match your agent, save.

## Interactive controls

Add a `controls:` array on `outputWidget` to render an interactive controls row above the widget body on the agent detail and run detail pages. State lives entirely in URL query params (no client JS), so refresh resets to defaults and links can be shared.

Three control types:

| Type | Purpose | Notes |
|---|---|---|
| `replay` | Re-run the agent inline | `inputs: []` (or omitted) = same-inputs replay; `inputs: [NAME]` exposes those agent inputs as inline form fields the user can tweak before re-running |
| `field-toggle` | Hide/show optional fields via chip toggles | `fields: [NAMES]` must reference declared widget fields; `default: shown` or `hidden` |
| `view-switch` | Tab-style switch between named subsets of fields | `views: [{id, fields: [...]}]`; `default:` names the active view's id |

Example — weather agent with all three controls:

```yaml
outputWidget:
  type: dashboard
  fields:
    - { name: temp_c, type: metric }
    - { name: temp_f, type: metric }
    - { name: wind, type: stat }
    - { name: uv, type: text }
  controls:
    - type: replay
      label: Refresh
      inputs: [CITY]
    - type: view-switch
      label: Units
      default: metric
      views:
        - { id: metric, fields: [temp_c, wind] }
        - { id: imperial, fields: [temp_f, wind] }
    - type: field-toggle
      label: Show
      fields: [uv]
      default: hidden
```

URL grammar:

- `?wv=<view-id>` — active view for the `view-switch`. Omitted = default view.
- `?wh=<csv-of-field-names>` — fields hidden via `field-toggle`. When `?wh=` mentions any toggle field, it's the authoritative hidden set; otherwise per-control `default:` applies.

`field-toggle` and `view-switch` are not supported on `ai-template` widgets — the template author controls layout directly. `replay` works on any widget type.

Controls render only on the agent detail and run detail pages. Pulse tiles render the widget statically — they're too small for inline controls in v1.

## Pulse integration

To show an agent's widget as a Pulse tile, set the agent's signal to use the `widget` template:

```yaml
signal:
  title: "Today's activity"
  icon: "📊"
  template: widget
  size: 2x1
```

The tile on `/pulse` then renders the same HTML the agent detail page shows for the most recent completed run. No slot mapping required.

## Related

- [Dashboard tour](dashboard.md#output-widget-editor) — how the editor UI works step-by-step
- [Templating](templating.md) — placeholder substitution in shell + claude-code
- [Security model](SECURITY.md#html-sanitizer-v018) — sanitizer allowlist
- [ADR 0020: AI template widget](adr/0020-ai-template-widget.md) — design tradeoffs
- [ADR 0021: HTML allowlist sanitizer](adr/0021-html-allowlist-sanitizer.md) — why zero-deps over DOMPurify
