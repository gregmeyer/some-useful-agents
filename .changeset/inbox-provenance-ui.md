---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

See what the inbox did on its own: provenance and verification, made legible.

Now that triage runs actions autonomously, the UI shows the autonomy trail instead of leaving you to infer it:

- **Action provenance** — each action card that ran shows how it was approved: **⚡ auto-ran** (by your trust policy, no click) vs **✓ you approved** (you clicked Run). Recorded as `approvedBy` on the action at claim time.
- **Source chips on the queue** — a run-failure (or cadence/permission) row is tagged right on the collapsed list row, so "why is this here" reads at a glance instead of only in the expanded preview.
- **Verification verdicts stand out** — the verify-on-resolve outcome from B1 renders as a verdict, not just another system line: a **✓ Verified** or **⚠ Not verified** badge with a matching accent, so you can tell "resolved because the fix was confirmed" from "resolved, nothing to check."
