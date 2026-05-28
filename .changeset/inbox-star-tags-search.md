---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox: star + tags + search/filter + sticky modal header.

Dogfood feedback: the modal title + body scrolled off-screen while the
conversation grew, and there was no way to find a specific thread
without scrolling the list.

- **`InboxStore` schema**: adds `starred` (boolean) and `tags_json`
  (JSON array) columns to `inbox_messages`. ALTER TABLE migrations
  are idempotent so existing installs pick them up. New helper
  `normalizeTags` lowercases / dedupes / sorts / drops invalid
  entries (must match `^[a-z0-9][a-z0-9_-]{0,31}$`).
- **`InboxStore.list`** gains `q` (full-text across title, body,
  agent_id, AND any conversation response body), `starred`, and
  `tag` (exact lowercase match, not substring) filters. Starred
  messages always sort above non-starred at the same priority.
- **`InboxStore.setStarred` / `setTags` / `listAllTags`** new
  methods.
- **Routes**: `POST /inbox/:id/star` (toggle / explicit value),
  `POST /inbox/:id/tags` (comma-separated input, normalized
  server-side). `GET /inbox` reads `?q` `?starred` `?tag` query
  params; all live in the URL so filtered views are bookmarkable.
- **List view** gains a filter bar (search input + Starred-only
  checkbox + All-tags dropdown), a star column, and tag chips on
  each row's title cell. Chips link to `/inbox?tag=…` for one-click
  filtering.
- **Modal**: the title + meta + tags + details + context wrap in
  `.inbox-detail__header` which uses `position: sticky` so the
  conversation thread scrolls below an always-visible header. Star
  toggle lives in the meta row; tag editor sits beneath the meta.
  Both forms POST via the existing modal `fetch` interceptor —
  in-place updates, no page reload.
- 36 new tests across the store (10 for star/tags/list-filters) and
  routes (~10 for filter rendering + the two new mutation routes +
  list-row + fragment rendering).
