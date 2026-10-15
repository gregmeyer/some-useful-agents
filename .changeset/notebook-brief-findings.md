---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook's brief is a summary of findings, and it prints properly as a PDF.

**New in the brief:**
- **Key findings,** worked out from the notebook itself: how many options were looked at and ruled out, the price or salary span in the running, and how many don't list it. Also the fit and measure spans, how the options split on a short fact like Remote, the most common reasons options were ruled out, what's still open, and where the last search looked.
- **The shortlist as a table,** then each option in detail with why it's there.
- **What was ruled out,** with reasons, and sua's notes.
- **One decision block** instead of a run-on sentence and a repeat.
- **Nothing folded away,** so the PDF has every option. "0/5 checks" and facts that repeat the title are gone.

**When printed:** colours are kept, no row splits across pages, link addresses are printed, and there's no trailing blank page. **Save as PDF** under **Download / share** opens the print dialog.

**Also fixed:** "Where it stands" shows a salary as its range ("$192,000–$300,000") rather than its midpoint, and a one-word name ("Director") keeps its next part.
