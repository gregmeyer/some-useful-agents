# ADR-0026: Code-sign the Apple runner for daemon + distributed TCC access

## Status

Proposed (roadmap — implement when un-gating the experimental Apple integration for distribution)

## Context

The experimental Apple Reminders/Notes integration (the `apple` integration
kind) drives EventKit and AppleScript through a small Swift runner that
`apple-runner.ts` **compiles on demand** per machine via `xcrun swiftc` and
caches at `~/.sua/runners/apple_reminders`. This mirrors the Apple Foundation
Models runner and needs no toolchain shipping — but it collides with macOS TCC
(Transparency, Consent & Control) in two ways:

1. **Daemons can't get Reminders access.** EventKit's Reminders grant is keyed
   on the *responsible process*. When the owner runs `sua apple authorize` in
   Terminal, the grant attaches to **Terminal.app**, not to sua's detached
   worker daemon. The temporal worker that executes agent nodes is therefore
   **denied** — verified live: `reminder-read` from the daemon returns
   "Reminders access denied," while the same call from a Terminal-rooted process
   succeeds. (Notes/Automation grants are broader and *do* carry to the daemon.)
   Net: reminder tools only work from a granted Terminal (`SUA_PROVIDER=local`),
   not from scheduled/background agents.

2. **Ad-hoc signatures aren't stable.** A `swiftc -o` binary is ad-hoc signed;
   its code-signing identity changes on every recompile, so even a granted TCC
   entry is invalidated whenever the source hash drifts and we rebuild.

Two interim mitigations exist and ship today:

- **Terminal + local provider** — run reminder agents via
  `SUA_PROVIDER=local sua workflow run` from the authorized Terminal.
- **LaunchAgent in the GUI session** (`sua worker install-launchagent`) — runs
  the worker under `launchctl ... gui/$UID`, where macOS *can* surface a TCC
  prompt and persist the grant. Durable per-machine, no certificate, but
  per-user-setup and not distributable.

Neither makes the integration "just work" for someone who installs sua from npm
and wants autonomous reminder agents.

## Decision

To make Reminders work from any process (daemon included) and for distributed
users, **ship a Developer ID–signed, notarized, prebuilt Apple runner** with an
embedded `Info.plist` (carrying `NSRemindersUsageDescription`) and the Reminders
entitlement, **replacing compile-on-demand for the signed distribution path**.

Because TCC then keys on the stable code-signing identity rather than the
responsible parent process:

- The owner approves a single proper prompt (with our usage string), and the
  grant persists across updates and applies under **any** launching process —
  detached daemon, LaunchDaemon, or Terminal.
- The same build+sign+notarize pipeline is reused by every native helper sua
  ships (the Foundation Models runner today; future macOS helpers).

Concrete shape (to detail at implementation time):

1. Build the runner as a signed Mach-O (or minimal `.app` bundle so an
   `Info.plist` + entitlements can be embedded) in CI on a macOS runner.
2. Sign with a **Developer ID Application** certificate; staple notarization.
3. Ship the prebuilt artifact (in the package or as a versioned download);
   `ensureAppleRunner` prefers the signed artifact and falls back to
   compile-on-demand only for local development.
4. Keep the source hash check for the dev path; the shipped path verifies the
   signature instead.

## Consequences

- **Pro:** background/scheduled reminder agents work; one grant per user; no
  per-machine LaunchAgent setup; reusable signing pipeline across native helpers.
- **Con:** requires an Apple Developer Program membership ($99/yr) + Developer
  ID cert managed as a CI secret; adds a notarization step (minutes per release);
  shifts distribution from "compile locally" to "ship a signed binary" (a real
  architectural change with a fallback to preserve the dev experience).
- **Scope gate:** only worth doing alongside un-gating `experimental.apple` for
  real distribution. Until then, the Terminal/local and LaunchAgent paths cover
  single-machine use.

## Alternatives considered

- **LaunchAgent only (ADR-less, shipped as Stage 2):** durable per-machine, no
  cert — but not distributable and requires the owner to wire it up.
- **Ad-hoc / self-signed:** unstable identity (recompile invalidates the grant)
  or not trusted off-machine. Rejected.
- **Stay Terminal-only:** simplest, but reminders never run autonomously.
  Acceptable for the experimental phase, not for shipping.
