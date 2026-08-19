/**
 * Auto-slug the agent Id from the Name on /agents/new.
 *
 * Typing a name is the part someone actually knows; the id is bookkeeping.
 * This mirrors the name into the id as you type, and stops the moment you
 * edit the id yourself — so it helps beginners without fighting anyone who
 * has a specific id in mind.
 *
 * The server slugifies too (routes/agents/new.ts), and that's the real
 * guarantee. This is only about not showing someone a validation error for
 * something we were always going to fix for them.
 */
export const AGENT_ID_SLUG_JS = `
  (function () {
    var name = document.querySelector('[data-slug-source]');
    var id = document.querySelector('[data-slug-target]');
    if (!name || !id) return;

    function slug(s) {
      return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    // If the field arrives with a value (a failed submit re-render), treat it
    // as the user's own — don't clobber what they came back to fix.
    var manual = id.value.trim().length > 0;

    id.addEventListener('input', function () {
      // Empty means "start following the name again"; that's the only way
      // back once you've taken manual control.
      manual = id.value.trim().length > 0;
    });

    name.addEventListener('input', function () {
      if (manual) return;
      id.value = slug(name.value);
    });

    // Tidy whatever is in the id when focus leaves, so the value that gets
    // submitted matches what the server will store.
    id.addEventListener('blur', function () {
      var cleaned = slug(id.value);
      if (cleaned !== id.value) id.value = cleaned;
    });
  })();
`;
