/**
 * Inline JS for the allowed-sub-agents picklist on /agents/:id/config.
 *
 * Wires the "Add agent…" button on the Allowed sub-agents card to a
 * modal that lets the operator pick from installed agents. Pattern
 * mirrors add-tile-modal.js.ts:
 *   - opens via [data-allowed-sub-agents-open]
 *   - reads the catalog from a JSON script tag baked into the page
 *   - renders agent cards with name + description; filters via search
 *   - clicking a card stages an addition (operator can pick several)
 *   - "Save" posts the merged list via the form; "Cancel" discards
 *
 * The modal is created lazily on first open so it doesn't pay layout
 * cost on every config tab visit.
 */

export const ALLOWED_SUB_AGENTS_PICKLIST_JS = `
(function () {
  var root = document.getElementById('allowed-sub-agents-picklist');
  if (!root) return;
  var catalogEl = document.getElementById('allowed-sub-agents-catalog');
  var catalog = [];
  try { catalog = JSON.parse(catalogEl && catalogEl.textContent ? catalogEl.textContent : '[]'); }
  catch (_) { catalog = []; }

  var agentId = root.getAttribute('data-agent-id') || '';
  var currentRaw = root.getAttribute('data-current') || '';
  var current = currentRaw ? currentRaw.split(',').filter(Boolean) : [];

  // Existing pill remove buttons — submit the form with one entry dropped.
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || !target.getAttribute) return;
    var removeId = target.getAttribute('data-sub-agent-remove');
    if (!removeId) return;
    e.preventDefault();
    var next = current.filter(function (id) { return id !== removeId; });
    submitList(next);
  });

  // Open picklist.
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || !target.getAttribute || target.getAttribute('data-allowed-sub-agents-open') === null) return;
    e.preventDefault();
    openPicker();
  });

  var modal = null;
  var staged = [];

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'add-tile-modal';
    modal.style.display = 'none';
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });
    document.body.appendChild(modal);
    document.addEventListener('keydown', function (e) {
      if (modal.style.display !== 'none' && e.key === 'Escape') closeModal();
    });
    return modal;
  }

  function closeModal() {
    if (modal) modal.style.display = 'none';
    staged = [];
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function cardHtml(agent) {
    var desc = agent.description ? '<div class="add-tile-card__desc">' + esc(agent.description) + '</div>' : '';
    var alreadyAllowed = current.indexOf(agent.id) !== -1;
    var stagedNow = staged.indexOf(agent.id) !== -1;
    var disabled = alreadyAllowed ? ' disabled' : '';
    var stateClass = alreadyAllowed
      ? ' add-tile-card--in-section'
      : (stagedNow ? ' add-tile-card--selected' : '');
    var stateLabel = alreadyAllowed
      ? '<span class="add-tile-card__age">already allowed</span>'
      : (stagedNow ? '<span class="add-tile-card__age">added</span>' : '');
    return '<button type="button" class="add-tile-card' + stateClass + '" data-sub-agent-pick="' + esc(agent.id) + '"' + disabled + '>' +
      '<div class="add-tile-card__head">' +
        '<span class="add-tile-card__name">' + esc(agent.name) + '</span>' +
      '</div>' +
      desc +
      '<div class="add-tile-card__foot">' +
        '<span class="add-tile-card__tpl mono">' + esc(agent.id) + '</span>' +
        stateLabel +
      '</div>' +
    '</button>';
  }

  function render() {
    var available = catalog.filter(function (a) { return a.id !== agentId; });
    var hasAny = available.length > 0;
    var cards = available.map(cardHtml).join('');
    var stagedCount = staged.length;
    var saveLabel = stagedCount === 0
      ? 'Save'
      : 'Save (+' + stagedCount + ')';
    modal.innerHTML = '<div class="add-tile-modal__content">' +
      '<div class="add-tile-modal__header">' +
        '<h3 style="margin: 0;">Pick sub-agents</h3>' +
        '<button type="button" class="add-tile-modal__close" title="Close" aria-label="Close">\\u00D7</button>' +
      '</div>' +
      '<p class="dim" style="margin: 0 0 var(--space-2); font-size: var(--font-size-sm);">Select the agents this agent may propose as sub-agent actions. Greyed-out cards are already allowed.</p>' +
      (hasAny
        ? '<input type="search" class="input add-tile-search" id="sub-agent-search" placeholder="Search agents\\u2026" autocomplete="off">' +
          '<div class="add-tile-grid" id="sub-agent-grid">' + cards + '</div>' +
          '<p class="add-tile-empty" id="sub-agent-no-results" style="display: none; padding: var(--space-4); text-align: center;">No agents match.</p>'
        : '<p class="dim" style="padding: var(--space-4); text-align: center;">No other agents installed yet.</p>') +
      '<div style="display: flex; justify-content: flex-end; gap: var(--space-2); padding: var(--space-3) 0 0;">' +
        '<button type="button" class="btn btn--sm btn--ghost" data-sub-agent-cancel>Cancel</button>' +
        '<button type="button" class="btn btn--sm btn--primary" data-sub-agent-save' + (stagedCount === 0 ? ' disabled' : '') + '>' + saveLabel + '</button>' +
      '</div>' +
    '</div>';

    modal.querySelector('.add-tile-modal__close').addEventListener('click', closeModal);
    modal.querySelector('[data-sub-agent-cancel]').addEventListener('click', closeModal);
    var saveBtn = modal.querySelector('[data-sub-agent-save]');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var merged = current.concat(staged);
        // dedupe
        var seen = {};
        var out = [];
        for (var i = 0; i < merged.length; i++) {
          if (!seen[merged[i]]) { seen[merged[i]] = true; out.push(merged[i]); }
        }
        closeModal();
        submitList(out);
      });
    }

    var cardEls = modal.querySelectorAll('[data-sub-agent-pick]');
    for (var i = 0; i < cardEls.length; i++) {
      cardEls[i].addEventListener('click', function () {
        var id = this.getAttribute('data-sub-agent-pick');
        if (!id || current.indexOf(id) !== -1) return;
        var idx = staged.indexOf(id);
        if (idx === -1) staged.push(id);
        else staged.splice(idx, 1);
        render();
      });
    }

    var search = document.getElementById('sub-agent-search');
    var grid = document.getElementById('sub-agent-grid');
    var noResults = document.getElementById('sub-agent-no-results');
    if (search && grid) {
      search.addEventListener('input', function () {
        var q = this.value.toLowerCase().trim();
        var visible = 0;
        var allCards = grid.querySelectorAll('.add-tile-card');
        for (var j = 0; j < allCards.length; j++) {
          var name = (allCards[j].querySelector('.add-tile-card__name') || {}).textContent || '';
          var desc = (allCards[j].querySelector('.add-tile-card__desc') || {}).textContent || '';
          var idText = (allCards[j].querySelector('.mono') || {}).textContent || '';
          var match = !q || (name + ' ' + desc + ' ' + idText).toLowerCase().indexOf(q) !== -1;
          allCards[j].style.display = match ? '' : 'none';
          if (match) visible++;
        }
        if (noResults) noResults.style.display = visible === 0 ? '' : 'none';
      });
      setTimeout(function () { search.focus(); }, 30);
    }
  }

  function openPicker() {
    ensureModal();
    staged = [];
    render();
    modal.style.display = 'flex';
  }

  function submitList(list) {
    // Build a one-shot form and submit. Using requestSubmit() so any
    // future submit-event listeners (e.g. edit-mode beforeunload
    // guards) get a chance to mark the navigation as intentional.
    var f = document.createElement('form');
    f.method = 'POST';
    f.action = '/agents/' + encodeURIComponent(agentId) + '/allowed-sub-agents';
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'agentIds';
    input.value = list.join(',');
    f.appendChild(input);
    document.body.appendChild(f);
    if (f.requestSubmit) f.requestSubmit();
    else f.submit();
  }
})();
`;
