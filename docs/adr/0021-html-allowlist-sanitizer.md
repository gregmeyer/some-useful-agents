# ADR-0021: HTML allowlist sanitizer (zero-deps)

## Status
Accepted

## Context
The `ai-template` output widget (ADR-0020) stores LLM-generated HTML and renders it on every run. Options for sanitization:

1. **Pull in DOMPurify** (`isomorphic-dompurify` ~30KB, battle-tested, handles every weird DOM case).
2. **Server-side via `jsdom` + DOMPurify** (~3MB with jsdom, overkill for 'parse a template once').
3. **Write a zero-deps allowlist sanitizer.**

Two things pushed us toward option 3:

- **The dependency footprint matters.** `core` is deliberately small — it has 6 deps today, all tight. Adding a sanitizer layer for one widget type would dwarf some existing deps.
- **The input surface is narrow.** LLM output isn't adversarial in the same way an untrusted user paste is. The sanitizer's job is "strip anything outside a known-good list," not "parse every corner of HTML5 correctly."

We accept that a zero-deps sanitizer will have more known gaps than DOMPurify; the question is whether those gaps are load-bearing.

## Decision
Ship a pure regex-based allowlist sanitizer in `packages/core/src/html-sanitizer.ts`. It:

1. **Strips dangerous block constructs entirely** via non-greedy regex — `<script>…</script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<noscript>`, `<template>`, `<xml>`, `<head>`, `<meta>`, `<link>`, `<form>`, `<input>`, `<button>`, `<select>`, `<textarea>`, `<frame>`, `<frameset>`, `<applet>`, `<base>`.
2. **Strips HTML comments** (`<!--…-->`) so IE conditional-script smuggling can't hide there.
3. **Walks all remaining tags** via `<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g`. For each:
   - Drops the tag if the (lowercased) name isn't in the allowlist, keeping inner text via the surrounding pass.
   - Parses attrs, drops any not in the per-tag allowlist. `on*` attrs are explicitly blocked belt-and-suspenders.
   - Filters URL attrs (`href`, `src`) through `isSafeUrl`: accepts `http(s)://`, `mailto:`, `data:image/*`, anchors, relative paths; rejects any other scheme.
   - Filters `style` through `sanitizeStyle`: strips `javascript:`, `vbscript:`, `expression()`, `url(javascript:…)` constructs.
   - Preserves original case for SVG tags (`linearGradient`, `clipPath`) and attrs (`viewBox`, `preserveAspectRatio`, `gradientUnits`) via two lookup maps.

Allowlist covers the HTML subset needed for polished layouts (including full SVG for inline charts). 16 unit tests pin the key escape paths.

The `substitutePlaceholders` helper escapes `{{outputs.X}}` / `{{result}}` values to entities before substitution, so the sanitizer is a second layer (defense-in-depth) rather than the only layer protecting against run-output-originated injection.

## Consequences
**Easier:** zero new runtime deps; 160 LOC + tests we own end-to-end; trivial to extend the allowlist when a new use case demands a tag.

**Harder:** we own the correctness curve. Known gaps we accept:
- Multi-line quoted attributes that span newlines may not parse correctly (sanitizer line-by-line only for content constructs it strips whole).
- Mutation XSS via novel DOM corner cases is in-theory possible (DOMPurify catches these; we don't). The run-output values are HTML-escaped first, so the path to exploit is "get the LLM to emit a payload that survives our strip + parse." Plausible but not trivial — the strict system prompt + allowlist narrow the surface considerably.
- CSS injection via `style` attr is a partial mitigation only; the known-bad constructs are stripped but creative CSS can still do layout-only damage (which is cosmetic for a widget rendered inside the dashboard's CSP).

**When to revisit:** if we start allowing untrusted agent authors (e.g., a public template gallery), or if a known CVE in our sanitizer surfaces. At that point swap to DOMPurify behind the same `sanitizeHtml()` function — the interface is the contract.

## Alternatives considered
- **DOMPurify** — see Context. Revisit when the threat model changes.
- **Deny-list instead of allow-list** — rejected on principle; deny-lists are never complete.
- **No sanitizer, rely only on HTML-escaping values** — rejected because the template itself is LLM-authored; the template can contain a `<script>` even if the values can't.
