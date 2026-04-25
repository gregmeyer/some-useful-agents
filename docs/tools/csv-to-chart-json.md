# csv-to-chart-json

Parse CSV into the shape `modern-graphics-generate-graphic` (or any compatible chart tool) expects. Supports three shapes: `simple`, `series`, `cohort`.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `csv` | string | one of csv/path | Raw CSV text |
| `path` | string | one of csv/path | Path to a CSV file (read relative to the run cwd) |
| `shape` | string | no | `simple` (default) \| `series` \| `cohort` |

## Outputs

| Name | Type | Description |
|---|---|---|
| `data_json` | string | JSON string ready for `generate_graphic` |
| `labels` | array | Parsed labels (simple / series shape) |
| `values` | array | Parsed values (simple shape) |
| `series` | array | Parsed series (series shape) |
| `cohorts` | array | Parsed cohorts (cohort shape) |
| `result` | string | Alias for `data_json` |

## Shapes

### `simple` — labels + values

First column = labels. Second column = numeric values.

**CSV:**
```
month,revenue
Jan,100
Feb,150
Mar,180
```

**Output:**
```json
{ "labels": ["Jan", "Feb", "Mar"], "values": [100, 150, 180] }
```

Use with `bar-chart`, `horizontal-bar-chart`, `pie-chart`, `donut-chart`.

### `series` — labels + named series

First column = labels. Remaining columns = one series each (header names the series).

**CSV:**
```
quarter,org,paid
Q1,10,5
Q2,20,8
Q3,35,14
```

**Output:**
```json
{
  "labels": ["Q1", "Q2", "Q3"],
  "series": [
    { "name": "org", "values": [10, 20, 35] },
    { "name": "paid", "values": [5, 8, 14] }
  ]
}
```

Use with `line-chart`, `grouped-bar-chart`, `stacked-bar-chart`, `stacked-area-chart`.

### `cohort` — cohort retention

Columns: `date`, `size`, then one column per period offset.

**CSV:**
```
date,size,m1,m2,m3
Sep 17,7262,95.6,33.5,31.3
Oct 17,8100,94.2,31.0,28.7
```

**Output:**
```json
{
  "cohorts": [
    { "date": "Sep 17", "size": 7262, "values": [95.6, 33.5, 31.3] },
    { "date": "Oct 17", "size": 8100, "values": [94.2, 31.0, 28.7] }
  ]
}
```

Use with `cohort-chart`.

## Example

```yaml
- id: parse
  tool: csv-to-chart-json
  toolInputs:
    csv: "{{inputs.CSV_TEXT}}"
    shape: simple

- id: chart
  tool: modern-graphics-generate-graphic
  dependsOn: [parse]
  toolInputs:
    layout: bar-chart
    title: "Revenue by month"
    data: "{{upstream.parse.result}}"
```

The bundled [`chart-creator-mcp`](../../agents/examples/chart-creator-mcp.yaml) agent uses exactly this pattern.

## Notes

- **CSV parser** handles quoted fields and escaped quotes (`"Jones, Inc."`, `"Smith ""Co"""`).
- **Numeric validation** — non-numeric values in a numeric column fail the call with a clear error pointing to the column name.
- **Header row is required** — the first line is always treated as column names.
- **Multi-line quoted fields are NOT supported** — keep each row on a single line.
