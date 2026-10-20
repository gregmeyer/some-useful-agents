"""Helpers for shell steps written in Python (docs/templating.md, "Shell helpers").

Every shell step finds this module on PYTHONPATH:

    python3 - <<'PY'
    from sua_helpers import upstream, upstream_json, last_json, emit
    ...
    PY

Before it, each agent kept its own copy of these, and a fix to one (a long
upstream result moved to a file; words around a model's JSON) didn't reach
the others.
"""

import json
import os
import re

__all__ = ["upstream", "upstream_json", "last_json", "tagged_json", "as_obj", "emit"]


def upstream(name):
    """An upstream step's whole result, as text ("" when there is none).

    `name` is the step id, as in UPSTREAM_<ID>_RESULT ("plan", "gather-1").
    Past 32KB the env value is cut short and the whole of it is in a file;
    this reads the file then.
    """
    key = "UPSTREAM_" + re.sub(r"[^A-Za-z0-9]", "_", name).upper() + "_RESULT"
    path = os.environ.get(key + "_FILE")
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read()
    return os.environ.get(key, "")


def last_json(text, *keys):
    """The object a model's reply carries, or None.

    A reply that is one JSON object as a whole (or already a dict) is that
    object. Otherwise it's the last top-level JSON object in the text: models
    add words around their JSON, or put it on the last line after a sentence.
    With keys, only an object that has one of them counts
    (last_json(reply, "found", "summary")); when no top-level object has one,
    the last object nested in them that does.
    """
    if isinstance(text, dict):
        return text
    if not isinstance(text, str):
        return None
    try:
        whole = json.loads(text)
        if isinstance(whole, dict):
            return whole
    except ValueError:
        pass
    dec = json.JSONDecoder()
    tops = []
    i = 0
    while True:
        start = text.find("{", i)
        if start < 0:
            break
        try:
            value, end = dec.raw_decode(text, start)
        except ValueError:
            i = start + 1
            continue
        if isinstance(value, dict):
            tops.append(value)
        i = end
    if not keys:
        return tops[-1] if tops else None
    has = lambda o: isinstance(o, dict) and any(k in o for k in keys)
    for o in reversed(tops):
        if has(o):
            return o
    nested = []

    def walk(v):
        if isinstance(v, dict):
            if has(v):
                nested.append(v)
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    for o in tops:
        walk(o)
    return nested[-1] if nested else None


def tagged_json(text, tag):
    """The JSON inside <tag>…</tag> in a reply, or None (tagged_json(reply, "verdicts"))."""
    m = re.search(rf"<{re.escape(tag)}>([\s\S]*?)</{re.escape(tag)}>", text or "")
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except ValueError:
        return None


def as_obj(value, *keys):
    """A sub-run's answer as an object: itself when it's one, else the last JSON object in its text."""
    return last_json(value, *keys)


def upstream_json(name, default=None, *keys):
    """An upstream step's result as JSON: the whole of it, else the last object in it, else default."""
    text = upstream(name).strip()
    if not text:
        return default
    try:
        return json.loads(text)
    except ValueError:
        pass
    got = last_json(text, *keys)
    return default if got is None else got


def emit(obj):
    """Print the step's result as one line of JSON (the line the next step reads)."""
    print(json.dumps(obj, ensure_ascii=False))
