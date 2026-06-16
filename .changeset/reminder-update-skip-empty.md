---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Apple reminder-update: empty optional fields mean "leave unchanged".

The `apple.apple.reminder-update` tool now omits `title`/`notes`/`dueDate` from
the payload when they arrive empty, instead of forwarding `""` and blanking the
field. Tool inputs come through as templated strings with no type coercion, so
an "edit a reminder" agent that maps every field would otherwise erase the ones
the operator didn't set. Now only the fields you actually provide are changed —
which is what makes a single edit-reminder agent (reschedule / retitle / re-note)
safe.
