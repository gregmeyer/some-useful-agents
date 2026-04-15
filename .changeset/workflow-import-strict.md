---
"@some-useful-agents/cli": minor
---

**fix: `sua workflow import` fails hard on YAML parse errors by default.**

Before: a single unparseable YAML file (bad shell quoting, invalid escape, schema violation) would silently drop that agent from the migration, printing a warning but continuing. When downstream agents used `dependsOn:` to reference the dropped agent, the chain silently broke — `post` would land as a single-node DAG instead of being merged into the `fetch → summarize → post` chain. Silent data loss on migration day is the worst possible shape.

Now:

- `sua workflow import` (with or without `--apply`) separates directory-level noise (missing optional `agents/examples/`) from file-level errors on actual YAML files
- File-level errors ABORT the migration with a clear list of which files failed and why
- `--allow-broken` opts into the old behavior (proceed anyway, drop the broken files) for users who know what they're skipping

```bash
sua workflow import --apply
# If any YAML file fails to parse:
#   ❌  3 YAML file(s) failed to load. These agents would be silently dropped
#       from the migration, which usually breaks dependsOn chains ...
#     ✖ agents/local/summarize.yaml
#         Invalid YAML: Invalid escape sequence \{ at line 3, column 87
#   → exit 1
```

No changes to the successful-migration path. Users with clean YAML see the same output they did before.

Prompted by a real incident during v0.14 bring-up where a `"\{print ...}"` double-quoted shell command inside YAML silently broke a three-node chain.
