---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox toolbar + modal polish — tighter, denser, fewer competing
visual elements.

**Toolbar** (`/inbox` upper-right):
- Drops the bordered card around the filter group; controls sit on
  the page background.
- Search input becomes a single 32px-tall pill with inline `⌕` icon
  and `×` clear button; submits on Enter and 350ms debounced input.
- "Starred" checkbox → chip toggle (active state filled, inactive
  outlined). Auto-submits on change.
- "All tags" → unstyled select inside a `# tags` chip. Auto-submits.
- Apply button removed entirely.
- `Clear` link renamed to `Reset` for consistency with other
  toolbars.

**Modal** (per-thread):
- `×` close button in the top-right corner; the separate "Close"
  link at the bottom-right is gone.
- Title row tightened: title + star only. Source label removed
  (it's implicit in the agent/run links and surfaced on the list).
- Meta row consolidated: priority dot + status badge + agent link +
  run link + age (right-aligned). Replaces the old loose flex of
  pills and timestamps.
- Tags now render as pills with inline `×` to remove; an
  always-present "Add tag…" input appends on Enter. Replaces the
  textarea + Save tags button.
- "DETAILS" and "CONTEXT PAYLOAD" headings removed — body lands
  directly; context becomes a small `▸` disclosure.
- "Reply" label dropped (placeholder is enough).
- Footer consolidated to ONE right-aligned row: `Ask triage`,
  `Dismiss`, and `Post reply` cluster together so the eye finds the
  primary action in a predictable spot. The primary button reaches
  the textarea form via `form="..."` so the composer + actions can
  occupy distinct visual zones without nesting.
- Grid-row unification: list-view rows and the modal share the same
  priority-dot + agent/run-link vocabulary, and the group headings on
  the list lighten (no uppercase, no raised background, no hard
  bottom border) so they read as section labels rather than
  competing chrome.
- Empty-body conversations (manual `+ New conversation` threads with
  no seeded body) hide the `(empty)` placeholder so the modal opens
  clean until the operator's first reply lands.
- Add-tag input renders as a dashed pill so it visually matches the
  existing tag pills instead of showing a bare borderless field with
  a heavy browser focus outline.

All CSS uses existing design tokens. No schema or route changes.
1808 tests pass.
