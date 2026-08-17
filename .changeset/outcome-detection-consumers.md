---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Outcome records now drive verification, the inbox, and the next run.

Outcome detection shipped able to produce evidence-backed records, but nothing
read them. This wires them in.

**Inbox threads no longer auto-resolve just because an agent exited 0.** The
verify-on-resolve gate decided whether a triage fix worked by checking that the
agent's latest run reached `completed` — so a thread closed as "fixed" for an
agent that ran perfectly and produced nothing. It now checks whether the run
achieved its declared outcome, quotes the failing check as evidence, and holds
the thread open when the outcome is undetermined rather than closing it.

**A run that completes but misses its outcome now raises an inbox thread.** This
is the silent-failure class: `run-failure` never fires for it, so a digest that
quietly produces zero headlines every morning previously generated no signal
anywhere. New `outcome` inbox source, `medium` priority, coalesced per agent so a
nightly miss yields one thread with a visible frequency. Never raised for failed
runs (`run-failure` owns those) or for undetermined outcomes. Disable with
`SUA_INBOX_OUTCOME_MISSES=0`.

**Records are visible where the run already lives.** `/runs/:id` shows the
outcome above the raw result — verdict, checks, evidence, and what could not be
determined — and inbox threads show a compact form of the same view. Triage gets
a new `FOCUS_AGENT_OUTCOME` input so it can tell "produced plausible output" from
"produced what it was supposed to".

**`OUTCOME_FEEDBACK` carries a miss into the next run** — the cross-run analogue
of `LOOP_FEEDBACK`. Declare the input to opt in; agents that don't are
unaffected. Only the immediately-previous run is read, and an undetermined
outcome produces no feedback. Nothing modifies an agent, prompt, or config.

See docs/outcome-detection.md and docs/adr/0030-outcome-detection.md.

Also closes a self-grading loop this created. The inbox can already replace an
agent's whole definition via `agent-editor`, and `outcome:` is an ordinary
optional field — so a rewrite that omitted it dropped it silently, letting a
failing agent be "fixed" by deleting the criteria that proved it failed.
`agent-editor` now carries `outcome` and `successCriteria` forward when the
replacement YAML omits them (and says so), verification requires a run that
post-dates the fix rather than accepting a pre-edit run as evidence, and the
auto-proposed editor card sets `effect: 'write'` — it never did, which meant the
verify-on-resolve gate never fired on the primary analyzer→editor path and
threads resolved without checking anything.
