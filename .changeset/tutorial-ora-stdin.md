---
"@some-useful-agents/cli": patch
---

Fix tutorial silently exiting after stage 3. ora's default `discardStdin: true` was fighting with readline: after the spinner stopped, stdin was left in a state that made subsequent `rl.question` calls fail silently, so the tutorial never reached stages 4 and 5. All ora calls in the tutorial now pass `discardStdin: false`. Also wraps each stage in a try/catch that logs errors before re-throwing, so future silent failures are visible.
