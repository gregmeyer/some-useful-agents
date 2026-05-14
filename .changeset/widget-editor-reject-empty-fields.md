---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Output-widget editor now rejects a save that would silently wipe `outputWidget.fields` for typed widgets (`dashboard`, `key-value`, `diff-apply`, `raw`).

Regression path: switching widget type from `ai-template` back to a typed widget via the editor cards shows an empty field table (the JS doesn't restore the prior rows). Clicking Save used to store `{ type: 'dashboard', fields: [] }`, which renders three blank divs AND silently dropped the previously-saved fields.

POST `/agents/:id/output-widget/update` now returns a 303 redirect with a flash error like *"Add at least one field for 'dashboard', or click Remove output widget to delete it entirely. The previous version had 3 fields — they were dropped because the form posted no rows."* — and leaves the stored widget untouched. The user either adds a row or uses the explicit Remove button.
