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
          '<div style="display: flex; justify-content: center; gap: var(--space-2); padding-bottom: var(--space-4);">' +
            '<a class="btn btn--ghost btn--sm" href="/agents/new">+ Blank agent</a>' +
            '<button type="button" class="btn btn--primary btn--sm" id="add-tile-build-from-goal">Build from goal</button>' +
          '</div>' +
        '</div>';
        modal.querySelector('.add-tile-modal__close').addEventListener('click', closeModal);
        var emptyBuildBtn = document.getElementById('add-tile-build-from-goal');
        if (emptyBuildBtn) {
          emptyBuildBtn.addEventListener('click', function () {
            closeModal();
            var trigger = document.getElementById('build-from-goal-btn');
            if (trigger) trigger.click();
          });
        }
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
        '<div class="add-tile-section-label">Create new</div>' +
        '<div class="add-tile-grid add-tile-grid--create">' +
          '<a class="add-tile-card add-tile-card--create" href="/agents/new">' +
            '<div class="add-tile-card__head">' +
              '<span class="add-tile-card__icon">\\u002B</span>' +
              '<span class="add-tile-card__name">Blank agent</span>' +
            '</div>' +
            '<div class="add-tile-card__desc">Start from an empty YAML and wire it up by hand.</div>' +
          '</a>' +
          '<button type="button" class="add-tile-card add-tile-card--create" id="add-tile-build-from-goal">' +
            '<div class="add-tile-card__head">' +
              '<span class="add-tile-card__icon">\\u2728</span>' +
              '<span class="add-tile-card__name">Build from goal</span>' +
            '</div>' +
            '<div class="add-tile-card__desc">Describe what you want and let Claude draft the agent.</div>' +
          '</button>' +
        '</div>' +
        '<input type="search" class="input add-tile-search" id="add-tile-search" placeholder="Search agents\\u2026" autocomplete="off">' +
        (suggested.length > 0
          ? '<div class="add-tile-section-label" id="add-tile-suggested-label">Suggested</div>' +
            '<div class="add-tile-grid" id="add-tile-suggested">' + suggested.map(cardHtml).join('') + '</div>'
          : '') +
        '<div class="add-tile-section-label">' + (suggested.length > 0 ? 'All agents' : 'Available agents') + ' (' + String(sorted.length) + ')</div>' +
        '<div class="add-tile-grid" id="add-tile-all">' + sorted.map(cardHtml).join('') + '</div>' +
        '<p class="add-tile-empty" id="add-tile-no-results" style="display: none; padding: var(--space-4); text-align: center;" class="dim">No agents match.</p>' +
      '</div>';

      modal.querySelector('.add-tile-modal__close').addEventListener('click', closeModal);

      var buildBtn = document.getElementById('add-tile-build-from-goal');
      if (buildBtn) {
        buildBtn.addEventListener('click', function () {
          closeModal();
          var trigger = document.getElementById('build-from-goal-btn');
          if (trigger) trigger.click();
        });
      }

      var form = document.getElementById('add-tile-form');
      var hiddenAgent = document.getElementById('add-tile-agent-id');
      // Only agent cards (with data-agent-id) submit the form; the
      // "Create new" tiles have their own handlers above and are skipped.
      // Use requestSubmit() so the submit event fires — widget-layout.js
      // listens for it and clears its edit-mode beforeunload guard. Bare
      // form.submit() bypasses that listener and triggers Chrome's
      // generic "Leave site?" dialog on top of the legit navigation.
      var cards = modal.querySelectorAll('.add-tile-card[data-agent-id]');
      for (var c = 0; c < cards.length; c++) {
        cards[c].addEventListener('click', function () {
          hiddenAgent.value = this.getAttribute('data-agent-id') || '';
          if (!hiddenAgent.value) return;
          if (form.requestSubmit) form.requestSubmit();
          else form.submit();
        });
      }

      var search = document.getElementById('add-tile-search');
      var noResults = document.getElementById('add-tile-no-results');
      var suggestedEl = document.getElementById('add-tile-suggested');
      var allEl = document.getElementById('add-tile-all');
      search.addEventListener('input', function () {
        var q = this.value.toLowerCase().trim();
        if (suggestedEl) suggestedEl.style.display = q ? 'none' : '';
        var suggestedLabel = document.getElementById('add-tile-suggested-label');
        if (suggestedLabel) suggestedLabel.style.display = q ? 'none' : '';
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
      var dashboardId = btn.getAttribute('data-dashboard-id') || '';
      var sectionIdx = btn.getAttribute('data-section-idx') || '0';
      var raw = btn.getAttribute('data-section-agent-ids') || '';
      var already = raw ? raw.split(',').filter(function (x) { return x; }) : [];
      openModal(dashboardId, parseInt(sectionIdx, 10), already);
    });
  })();
`;
