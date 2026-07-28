# Pattern: SQLite-backed log + browsable table widget

A reusable two-agent shape for any structured log you append to and browse:
**a writer agent** appends rows to a shared SQLite database, and **a reader
agent** queries it and renders the rows as a `table` dashboard widget. Use it
for decision records, experiment results, incidents, reading lists — anything
that's "append a row, then browse/filter the rows."

The worked example is the pair [`agents/examples/adr-logger.yaml`](../../agents/examples/adr-logger.yaml)
(writer) and [`agents/examples/adr-browser.yaml`](../../agents/examples/adr-browser.yaml)
(reader), which keep an Architectural Decision Record log.

## Shape

```
 ┌─────────────┐   INSERT row    ┌──────────────────────┐   SELECT rows   ┌─────────────┐
 │ writer agent│ ───────────────▶│  shared SQLite file   │◀─────────────── │ reader agent│
 │ (adr-logger)│                 │  DB_PATH · table `t`  │                 │ (adr-browser)│
 └─────────────┘                 └──────────────────────┘                 └──────┬──────┘
                                                                                  │ table widget
                                                                                  ▼
                                                                          dashboard table
```

## The contract (the one thing that breaks it)

The writer and reader **must agree on two values**: the `DB_PATH` and the
**table name**. If the writer inserts into `STATE_DIR/log.db`/`entries` while the
reader queries `data/log.db`/`records`, the reader always shows zero rows even
though both "work". Make `DB_PATH` an input with the **same default** on both
agents, and hardcode the same table name in both SQL statements.

## Writer node

A `type: shell` node: create-if-missing, insert one row (single-quote-escaped),
then emit a **single-line** framed JSON object so the executor lifts the fields.

```bash
DB="${DB_PATH:-data/log.db}"; mkdir -p "$(dirname "$DB")"
sqlite3 "$DB" "CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, /* … your columns … */
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);"
esc() { printf '%s' "$1" | sed "s/'/''/g"; }   # SQL-escape user input
sqlite3 "$DB" "INSERT INTO entries (title) VALUES ('$(esc "$TITLE")');"
sqlite3 -json "$DB" "SELECT * FROM entries ORDER BY id DESC LIMIT 1;" \
  | jq -c '.[0] as $r | { recorded: $r, headline: ("Recorded #" + ($r.id|tostring)) }'
```

## Reader node

A single `type: shell` node — **no `end` node** (an `end` node would overwrite
the run's `result` with its own message, hiding the query output). Return the
rows as a top-level array the table widget iterates. Treat an empty/missing log
as a normal data state (exit 0 with `[]`), not a failure.

```bash
DB="${DB_PATH:-data/log.db}"
[ -f "$DB" ] || { echo '{"headline":"No log yet","match_count":0,"entries":[]}'; exit 0; }
ROWS=$(sqlite3 -readonly -json "$DB" "SELECT * FROM entries ORDER BY id DESC LIMIT ${LIMIT:-25};")
[ -n "$ROWS" ] || ROWS='[]'
echo "$ROWS" | jq -c '{ match_count: length, entries: . }'
```

## Widget

Only `dashboard` widgets support `table` fields, over a top-level array in the
output. Add a hero `metric` for the count and a `table` over the array:

```yaml
outputWidget:
  type: dashboard
  fields:
    - { name: match_count, label: Entries, type: metric }
    - name: entries        # the top-level array
      type: table
      columns:
        - { name: id, label: "#" }
        - { name: title, label: Title }
        - { name: created_at, label: Recorded }
  controls:
    - { type: filter, field: entries, columns: [title] }   # client-side filter
    - { type: replay, label: Search, inputs: [SEARCH, LIMIT] }
```

## Gotchas (each one bit the ADR example first)

- **Framed output must be a single line.** The executor lifts structured fields
  only when the *last* stdout line is a complete JSON object. Pretty-printed
  multi-line `jq` output is not lifted — always `jq -c`.
- **`table` fields are `dashboard`-only.** On `key-value`/`raw` a table field is
  rejected; array data renders as a `code` blob.
- **`end` nodes overwrite the result.** The reader's array is the run output —
  don't route it through an `end` node. If you must, set a neutral `endMessage`
  (the default reads as a failure to operators and the analyzer).
- **Writer ≠ reader path/table = silent zero rows.** See the contract above.
- **Escape user input** with `sed "s/'/''/g"` before interpolating into SQL, and
  use `-readonly` on the reader.

## Try it

```bash
sua agent run adr-logger \
  --input TITLE="Adopt X" --input CONTEXT="…" --input DECISION="…" --input STATUS=accepted
sua agent run adr-browser        # open the run to see the table widget
```
