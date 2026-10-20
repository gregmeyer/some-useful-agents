---
name: shell-steps
description: How a Python shell step reads upstream results and a model's JSON — the shared sua_helpers module, never its own copy of those helpers.
---

A shell step written in Python imports the shared helpers instead of defining
its own (they're on PYTHONPATH for every shell step):

```python
python3 - <<'PY'
import json, os
from sua_helpers import upstream, upstream_json, last_json, emit

plan = upstream_json("plan", {})          # whole JSON, else the last object in it
reply = last_json(upstream("research"), "found", "summary")
emit({"ok": True, "items": plan.get("items", [])})
PY
```

- `upstream("step-id")`: an upstream step's whole result as text. Past 32KB
  `$UPSTREAM_<ID>_RESULT` is cut short and the rest is in a file; this reads
  the file, so a long result isn't silently truncated.
- `last_json(text, *keys)`: the last top-level JSON object in a model's reply
  (models add words around their JSON). With keys, only an object that has
  one of them; a nested object is never picked on its own.
- `upstream_json("step-id", default)`: the result as JSON, else the last
  object in it, else the default.
- `emit(obj)`: print the step's result as one line of JSON.

Never paste your own `def upstream` or JSON-scanning loop into a step: a fix
to the shared one then misses yours.
