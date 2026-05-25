# ADR-0025: Verify hardcoded image links during build evaluation

## Status
Accepted

## Context

Generated agents frequently render images — a Pulse tile with a portrait, a
dashboard card with a logo. Two layers already guard the image path:

1. **CSP host allowlist** — an agent declares `permissions.imgSrc: [host]`, which
   the dashboard merges into the page-wide `img-src` directive so the browser
   won't block the load (ADR-0021, the HTML sanitizer + CSP).
2. **Structural critic** — `build-plan-critic.ts` scans each ai-template for
   hardcoded `<img src="https://HOST/...">` and fails the build if `HOST` isn't
   declared in `permissions.imgSrc`.

Both check whether a host is *allowed*. Neither checks whether the specific URL
*resolves*. That gap produced a real broken widget: a drafted
"Marvel hero of the day" agent baked an array of ~30 Wikimedia portrait URLs
into a `pick-hero` shell node, and the drafter LLM hallucinated the
hash-prefixed paths (`/wikipedia/en/1/14/Rogue_%28Marvel_Comics%29.jpg`).
`upload.wikimedia.org` was correctly allowlisted, so CSP passed and the critic
was happy — but ~1/3 of the URLs returned HTTP 404, and the widget rendered
broken images. The dashboard was behaving correctly; the data was wrong.

Crucially, these URLs are **literals in the generated agent definition**, not
runtime output. So they can be extracted and verified at build-eval time —
before the agent is ever committed — rather than only failing when a user views
a run.

## Decision

Add an **image-link verifier** to the build evaluation
(`packages/core/src/build-plan-image-check.ts`):

- Extract every `http(s)` URL ending in a known image extension from each
  generated agent's YAML (covers shell commands and ai-template HTML alike).
- HEAD-check each unique URL (1-byte ranged GET fallback for hosts that reject
  HEAD), with a real User-Agent and a hard timeout.
- Flag a URL as dead **only** on a definitively-gone status (HTTP 404/410).
  Feed dead links back to the planner/drafter as critic-style feedback for a
  retry, on the same footing as structural critic errors.

Wired into both evaluation surfaces:
- `PlannerLoopRunner` evaluate phase (multi-agent plans) — via an optional
  injected `checkImageUrl` dependency.
- The single-agent drafter critic-retry loop in `build-orchestrator.ts`.

### Why 404/410 only

Failing a build for an inconclusive result would be worse than the broken image
it prevents:
- **Network error / timeout** — the build host may be offline or sandboxed.
- **403** — hotlink protection; the image usually exists and renders in-browser.
- **429** — rate-limiting from our own rapid checks, not a dead resource.
- **5xx** — transient server fault.

All of these are treated as inconclusive and never flagged. Only "the resource
is gone" (404/410) is actionable and unambiguous.

### Why inject the checker

The per-URL checker is a constructor/dependency parameter, not a hardcoded
`fetch`. The planner loop stays deterministic and network-free by default, so
unit tests (and offline builds) skip the network entirely; the dashboard wires
the real `defaultCheckImageUrl`.

### Why not verify template placeholders

`<img src="{{outputs.image_url}}">` binds to a runtime value that doesn't exist
at build time, so it can't be statically verified. Data URIs can't 404. Both are
skipped; this ADR addresses only literal asset URLs the LLM hand-wrote.

## Consequences

**Positive:**
- Catches hallucinated asset URLs at generation time, with the exact dead URL +
  status in the retry feedback, so the LLM fixes the source instead of shipping
  broken images.
- Reuses the existing critic-retry machinery — no new loop, no new UI.
- Conservative flagging keeps false-positive build failures near zero.

**Negative:**
- The build eval now makes outbound network requests (bounded: only literal
  image URLs, deduped, concurrency-capped, with a timeout). The dependency is
  opt-in, so any caller that wants a hermetic build omits `checkImageUrl`.
- A URL that 404s only intermittently (or after the build) still slips through —
  this is a generation-time gate, not a runtime monitor. Graceful runtime
  fallback for broken widget images remains future work.

## Alternatives considered

- **Pure static heuristic (no network)** — flag *any* hardcoded external image
  URL as risky and tell the planner to resolve images at runtime. Rejected as
  the primary mechanism: it can't tell a good URL from a dead one, so it would
  flag working agents (noisy) while still not proving the bad ones are bad.
  Its guidance ("prefer runtime resolution over baked URLs") is folded into the
  dead-link feedback message instead.
- **Dynamic verification by executing the agent** — run the drafted agent, then
  HTTP-check the URLs it emits. Rejected: far more expensive and nondeterministic
  than checking the literals already present in the definition, and unnecessary
  here because the bad URLs are static.
- **Runtime broken-image fallback only** — degrade gracefully in the widget when
  an `<img>` 404s. Complementary, not a substitute: it hides the symptom but
  still ships an agent with dead links. Tracked separately.

## References

- ADR-0021 (HTML allowlist sanitizer) — the CSP `img-src` allowlist this
  verifier complements.
- ADR-0024 (build-planner split) — the drafter critic-retry loop this check
  plugs into.
- [docs/build-from-goal.md](../build-from-goal.md) — user-facing guide.
