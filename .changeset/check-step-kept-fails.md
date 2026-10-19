---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/temporal-provider": patch
---

A check step can finish when options you chose fail a check.

A check that fails on an option you've chosen leaves it chosen (with a note), but it was never ticked, so the check step counted that option as unchecked forever and stayed stuck. The failed check is now recorded on the option. It counts as checked, isn't asked again, and shows as ✗ "fails; you kept it". The note is written once per option and check, not once per wording of the quote, and the run note counts these ("2 failed on ones you chose (kept)").
