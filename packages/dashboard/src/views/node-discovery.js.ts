/**
 * Client JS for the node-discovery picklist on the add-node form.
 *
 * Wires:
 *   - [data-node-discovery-open]   → opens the modal
 *   - [data-node-discovery-close]  → closes
 *   - #node-discovery-search       → filters cards by name/desc/toolId
 *   - [data-node-discovery-pick]   → sets the tool dropdown + closes
 *
 * The pick handler reuses the same dropdown-mutation the existing
 * pattern-strip buttons use: set `#node-tool-select` value, dispatch
 * change so the dynamic tool-inputs section re-renders, then
 * optionally fill `toolInput_*` fields from the card's defaults.
 *
 * Lazy guards: every selector returns early when the relevant element
 * isn't on the page (the add-node form isn't on every dashboard route).
 */

export const NODE_DISCOVERY_JS = `
(function () {
  var modal = document.getElementById('node-discovery-modal');
  if (!modal) return;
  var body = document.getElementById('node-discovery-body');
  var emptyMsg = document.getElementById('node-discovery-empty');
  var searchInput = document.getElementById('node-discovery-search');

  function open() {
    modal.hidden = false;
    modal.classList.add('is-open');
    if (searchInput) {
      searchInput.value = '';
      applyFilter('');
      setTimeout(function () { searchInput.focus(); }, 30);
    }
  }
  function close() {
    modal.hidden = true;
    modal.classList.remove('is-open');
  }

  document.addEventListener('click', function (e) {
    var openBtn = e.target.closest && e.target.closest('[data-node-discovery-open]');
    if (openBtn) { e.preventDefault(); open(); return; }
    var closeBtn = e.target.closest && e.target.closest('[data-node-discovery-close]');
    if (closeBtn) { e.preventDefault(); close(); return; }
    if (e.target === modal) { close(); return; }
    var pick = e.target.closest && e.target.closest('[data-node-discovery-pick]');
    if (pick) { e.preventDefault(); selectEntry(pick); }
  });

  document.addEventListener('keydown', function (e) {
    if (modal.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      applyFilter(String(this.value || '').toLowerCase().trim());
    });
  }

  function applyFilter(q) {
    if (!body) return;
    var cards = body.querySelectorAll('[data-node-discovery-pick]');
    var groups = body.querySelectorAll('.node-discovery__group');
    var anyVisible = false;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var text = card.textContent.toLowerCase();
      var match = !q || text.indexOf(q) !== -1;
      card.style.display = match ? '' : 'none';
      if (match) anyVisible = true;
    }
    // Hide group headers whose cards are all filtered out.
    for (var j = 0; j < groups.length; j++) {
      var g = groups[j];
      var visibleInGroup = g.querySelectorAll('[data-node-discovery-pick]');
      var hasAny = false;
      for (var k = 0; k < visibleInGroup.length; k++) {
        if (visibleInGroup[k].style.display !== 'none') { hasAny = true; break; }
      }
      g.style.display = hasAny ? '' : 'none';
    }
    if (emptyMsg) emptyMsg.hidden = anyVisible;
  }

  function selectEntry(card) {
    var toolId = card.getAttribute('data-node-discovery-pick');
    if (!toolId) return;
    var sel = document.getElementById('node-tool-select');
    if (!sel) { close(); return; }
    sel.value = toolId;
    // Verify the option exists — if a card references a tool the
    // dropdown doesn't have (drift between modal payload and the
    // server-rendered options), silently bail without changing
    // selection so the operator can pick again.
    if (sel.value !== toolId) { close(); return; }
    sel.dispatchEvent(new Event('change'));

    var defaultsAttr = card.getAttribute('data-node-discovery-defaults');
    if (defaultsAttr) {
      try {
        var defaults = JSON.parse(defaultsAttr);
        // Wait one frame for the change-event handler to re-render
        // the toolInput_* fields, then fill them.
        requestAnimationFrame(function () {
          for (var key in defaults) {
            if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue;
            var inp = document.querySelector('[name="toolInput_' + key + '"]');
            if (inp) inp.value = defaults[key];
            else if (key === 'command') {
              var cmd = document.querySelector('[name="command"]');
              if (cmd) cmd.value = defaults[key];
            } else if (key === 'prompt') {
              var pr = document.querySelector('[name="prompt"]');
              if (pr) pr.value = defaults[key];
            }
          }
        });
      } catch (_) { /* ignore */ }
    }
    close();
  }
})();
`;
