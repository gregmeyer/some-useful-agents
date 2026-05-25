---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix `sua dashboard start` crashing / mis-starting when the port is in use.

Express's `app.listen(port, host, cb)` invokes its callback even when the bind
fails, so a busy port (EADDRINUSE) could resolve an unbound server — printing a
bogus "running" banner — or leak as an uncaught error and crash on startup.
Binding now keys off the `listening` event so a port conflict reliably rejects.
The CLI then reports it clearly: if a dashboard is already running it prints the
sign-in URL and exits 0; otherwise it explains the port is taken and suggests
`--port <port>`.
