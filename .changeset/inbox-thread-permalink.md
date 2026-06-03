---
"@some-useful-agents/dashboard": patch
---

fix(dashboard): give inbox threads a durable permalink from the modal

Opening a thread from `/inbox` now updates the browser URL to
`/inbox/:id` instead of leaving the address bar on the list view.
That makes a modal-opened thread linkable with normal browser copy,
and browser back/forward now closes and reopens the same thread
instead of dropping that state on the floor.

The thread header also exposes an `Open page` action so the full-page
detail route is visible from the normal inbox flow.
