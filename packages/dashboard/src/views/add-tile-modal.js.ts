/**
 * In-place add-tile modal for /dashboards/:id. Opens when the
 * "+ Add tile" button in a section header is clicked (visible only
 * in edit mode). Renders a "Suggested" row (most-recently-fired
 * signal-bearing agents) above a searchable grid of every other
 * available agent. Picking a card POSTs to
 * /dashboards/:id/sections/:idx/tiles with returnTo=live so the
 * server redirects back to the live dashboard.
 */
export const ADD_TILE_MODAL_JS = `
  (function () {
    var modal = null;
    var allAgents = null;

    function getAvailable() {
      if (allAgents) return allAgents;
      var el = document.getElementById('dashboard-available-agents');
      if (!el) return [];
      try { allAgents = JSON.parse(el.textContent || '[]'); } catch { allAgents = []; }
      return allAgents;
    }

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function ensureModal() {
      if (modal) return;
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
    }

    function closeModal() {
      if (modal) modal.style.display = 'none';
    }

    function sortByRecency(agents) {
      return agents.slice().sort(function (a, b) {
        var aT = a.lastFiredAt ? Date.parse(a.lastFiredAt) : 0;
        var bT = b.lastFiredAt ? Date.parse(b.lastFiredAt) : 0;
        return bT - aT;
      });
    }

    function relAge(iso) {
      if (!iso) return 'never fired';
      var t = Date.parse(iso);
      if (isNaN(t)) return '';
      var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
      if (s < 60) return s + 's ago';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      if (s < 86400) return Math.floor(s / 3600) + 'h ago';
      return Math.floor(s / 86400) + 'd ago';
    }

    function cardHtml(agent) {
      var icon = agent.icon || '\\u25A1';
      var tpl = agent.template ? '<span class="add-tile-card__tpl">' + esc(agent.template) + '</span>' : '';
      var desc = agent.description ? '<div class="add-tile-card__desc">' + esc(agent.description) + '</div>' : '';
      return '<button type="button" class="add-tile-card" data-agent-id="' + esc(agent.id) + '">' +
        '<div class="add-tile-card__head">' +
          '<span class="add-tile-card__icon">' + esc(icon) + '</span>' +
          '<span class="add-tile-card__name">' + esc(agent.name) + '</span>' +
        '</div>' +
        desc +
        '<div class="add-tile-card__foot">' + tpl +
          '<span class="add-tile-card__age">' + esc(relAge(agent.lastFiredAt)) + '</span>' +
        '</div>' +
      '</button>';
    }

    function openModal(dashboardId, sectionIdx, alreadyInSection) {
      ensureModal();
      var all = getAvailable();
      var skip = {};
      for (var i = 0; i < alreadyInSection.length; i++) skip[alreadyInSection[i]] = true;
      var pool = all.filter(function (a) { return !skip[a.id]; });

      if (pool.length === 0) {
        modal.innerHTML = '<div class="add-tile-modal__content">' +
          '<div class="add-tile-modal__header">' +
            '<h3 style="margin: 0;">Add tile</h3>' +
            '<button type="button" class="add-tile-modal__close" title="Close" aria-label="Close">\\u00D7</button>' +
          '</div>' +
          '<p class="dim" style="padding: var(--space-4); text-align: center;">No more agents available.</p>' +
          '<div style="text-align: center; padding-bottom: var(--space-4);">' +
            '<a class="btn btn--primary btn--sm" href="/agents/new">Build a new agent \\u2192</a>' +
          '</div>' +
        '</div>';
        modal.querySelector('.add-tile-modal__close').addEventListener('click', closeModal);
        modal.style.display = 'flex';
        return;
      }

      var sorted = sortByRecency(pool);
      var suggestedCount = Math.min(4, sorted.length);
      var suggested = sorted.slice(0, suggestedCount).filter(function (a) { return a.lastFiredAt; });

      modal.innerHTML = '<div class="add-tile-modal__content">' +
        '<div class="add-tile-modal__header">' +
          '<h3 style="margin: 0;">Add tile</h3>' +
          '<button type="button" class="add-tile-modal__close" title="Close" aria-label="Close">\\u00D7</button>' +
        '</div>' +
        '<form id="add-tile-form" method="POST" action="/dashboards/' + encodeURIComponent(dashboardId) + '/sections/' + encodeURIComponent(String(sectionIdx)) + '/tiles">' +
          '<input type="hidden" name="returnTo" value="live">' +
          '<input type="hidden" name="agentId" id="add-tile-agent-id" value="">' +
        '</form>' +
        '<input type="search" class="input add-tile-search" id="add-tile-search" placeholder="Search agents\\u2026" autocomplete="off">' +
        (suggested.length > 0
          ? '<div class="add-tile-section-label">Suggested</div>' +
            '<div class="add-tile-grid" id="add-tile-suggested">' + suggested.map(cardHtml).join('') + '</div>'
          : '') +
        '<div class="add-tile-section-label">' + (suggested.length > 0 ? 'All agents' : 'Available agents') + ' (' + String(sorted.length) + ')</div>' +
        '<div class="add-tile-grid" id="add-tile-all">' + sorted.map(cardHtml).join('') + '</div>' +
        '<p class="add-tile-empty" id="add-tile-no-results" style="display: none; padding: var(--space-4); text-align: center;" class="dim">No agents match.</p>' +
      '</div>';

      modal.querySelector('.add-tile-modal__close').addEventListener('click', closeModal);

      var form = document.getElementById('add-tile-form');
      var hiddenAgent = document.getElementById('add-tile-agent-id');
      var cards = modal.querySelectorAll('.add-tile-card');
      for (var c = 0; c < cards.length; c++) {
        cards[c].addEventListener('click', function () {
          hiddenAgent.value = this.getAttribute('data-agent-id') || '';
          if (hiddenAgent.value) form.submit();
        });
      }

      var search = document.getElementById('add-tile-search');
      var noResults = document.getElementById('add-tile-no-results');
      var suggestedEl = document.getElementById('add-tile-suggested');
      var allEl = document.getElementById('add-tile-all');
      search.addEventListener('input', function () {
        var q = this.value.toLowerCase().trim();
        if (suggestedEl) suggestedEl.style.display = q ? 'none' : '';
        var labels = modal.querySelectorAll('.add-tile-section-label');
        if (labels[0] && suggestedEl) labels[0].style.display = q ? 'none' : '';
        var visible = 0;
        var allCards = allEl.querySelectorAll('.add-tile-card');
        for (var i = 0; i < allCards.length; i++) {
          var name = (allCards[i].querySelector('.add-tile-card__name') || {}).textContent || '';
          var desc = (allCards[i].querySelector('.add-tile-card__desc') || {}).textContent || '';
          var match = !q || (name + ' ' + desc).toLowerCase().indexOf(q) !== -1;
          allCards[i].style.display = match ? '' : 'none';
          if (match) visible++;
        }
        noResults.style.display = visible === 0 ? '' : 'none';
      });

      modal.style.display = 'flex';
      setTimeout(function () { search.focus(); }, 0);
    }

    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.add-tile-btn') : null;
      if (!btn) return;
      // Only react when in edit mode (button is CSS-hidden otherwise, but
      // belt-and-braces against keyboard-triggered clicks).
      if (!document.body.classList.contains('pulse-edit-mode')) return;
      var dashboardId = btn.getAttribute('data-dashboard-id') || '';
      var sectionIdx = btn.getAttribute('data-section-idx') || '0';
      var raw = btn.getAttribute('data-section-agent-ids') || '';
      var already = raw ? raw.split(',').filter(function (x) { return x; }) : [];
      openModal(dashboardId, parseInt(sectionIdx, 10), already);
    });
  })();
`;
