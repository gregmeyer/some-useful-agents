/**
 * The agent Settings page (views/agent-detail/config.ts).
 *
 * Every batched control carries form="agent-settings". This script remembers
 * where each one started, and as you edit it marks the changed sections (and
 * their dots in the side menu), shows the sticky bar ("N unsaved changes ·
 * Discard · Review · Save as vN"), fills Review from the server's own reading
 * of the form (POST preview=1, so the list says exactly what Save will do),
 * and warns before leaving with unsaved changes. Save is a plain form submit.
 *
 * Also: the schedule chips write the custom-schedule field, and the model
 * field's suggestions follow the provider.
 */
export const AGENT_SETTINGS_JS = `
  (function () {
    var form = document.getElementById('agent-settings');
    if (!form || !form.hasAttribute('data-settings-form')) return;
    var bar = document.querySelector('[data-settings-bar]');
    var countEl = document.querySelector('[data-settings-count]');
    var saveBtn = document.querySelector('[data-settings-save]');
    var reviewBtn = document.querySelector('[data-settings-review]');
    var reviewList = document.querySelector('[data-settings-review-list]');
    var controls = Array.prototype.slice.call(document.querySelectorAll('[form="agent-settings"]'))
      .filter(function (el) { return el.name && el.type !== 'submit'; });
    var submitting = false;

    function valueOf(el) { return el.type === 'checkbox' ? (el.checked ? '1' : '') : String(el.value).trim(); }
    var initial = controls.map(valueOf);

    function changedControls() {
      return controls.filter(function (el, i) { return valueOf(el) !== initial[i]; });
    }

    function sectionOf(el) {
      var s = el.closest('[data-settings-section]');
      return s ? s.getAttribute('data-settings-section') : '';
    }

    function closeReview() {
      if (!reviewList) return;
      reviewList.hidden = true;
      reviewList.innerHTML = '';
      if (reviewBtn) { reviewBtn.setAttribute('aria-expanded', 'false'); reviewBtn.textContent = 'Review'; }
    }

    function update() {
      var changed = changedControls();
      var sections = {};
      changed.forEach(function (el) { sections[sectionOf(el)] = true; });
      // Provider + model read as one change ("Model"), like the server says it.
      var n = changed.filter(function (el) { return !(el.name === 'model' && changed.some(function (c) { return c.name === 'provider'; })); }).length;
      document.querySelectorAll('[data-settings-section]').forEach(function (s) {
        s.classList.toggle('is-changed', !!sections[s.getAttribute('data-settings-section')]);
      });
      document.querySelectorAll('[data-settings-nav]').forEach(function (a) {
        var on = !!sections[a.getAttribute('data-settings-nav')];
        a.classList.toggle('is-changed', on);
        var sr = a.querySelector('[data-settings-nav-changed]');
        if (sr) sr.textContent = on ? ' (changed)' : '';
      });
      if (!bar) return;
      bar.hidden = n === 0;
      if (countEl) countEl.textContent = n + ' unsaved ' + (n === 1 ? 'change' : 'changes');
      if (saveBtn) {
        var versioned = changed.some(function (el) { return el.hasAttribute('data-versioned'); });
        saveBtn.textContent = versioned ? 'Save as v' + saveBtn.getAttribute('data-next-version') : 'Save';
      }
      if (n === 0) closeReview();
      else if (reviewList && !reviewList.hidden) loadReview();
    }

    // ── Schedule chips write the custom field ───────────────────────
    var scheduleInput = document.querySelector('[data-settings-schedule]');
    var chips = document.querySelectorAll('.settings-chip[data-cron]');
    function syncChips() {
      if (!scheduleInput) return;
      var v = scheduleInput.value.trim();
      chips.forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-cron') === v ? 'true' : 'false'); });
    }
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        if (!scheduleInput) return;
        scheduleInput.value = c.getAttribute('data-cron') || '';
        syncChips();
        update();
      });
    });
    if (scheduleInput) scheduleInput.addEventListener('input', syncChips);

    // ── Model suggestions follow the provider ───────────────────────
    var providerSel = document.querySelector('[data-settings-provider]');
    var datalist = document.getElementById('settings-models');
    var suggestions = {};
    try {
      var raw = document.querySelector('[data-settings-model-suggestions]');
      if (raw) suggestions = JSON.parse(raw.textContent || '{}');
    } catch (_) { suggestions = {}; }
    function fillModels() {
      if (!datalist || !providerSel) return;
      var list = suggestions[providerSel.value || 'claude'] || [];
      datalist.innerHTML = '';
      list.forEach(function (m) {
        var o = document.createElement('option');
        o.value = m.id;
        o.label = m.label + ': ' + m.desc;
        datalist.appendChild(o);
      });
    }
    if (providerSel) providerSel.addEventListener('change', fillModels);
    fillModels();

    controls.forEach(function (el) {
      el.addEventListener('input', update);
      el.addEventListener('change', update);
    });

    // ── Discard ──────────────────────────────────────────────────────
    var discardBtn = document.querySelector('[data-settings-discard]');
    if (discardBtn) discardBtn.addEventListener('click', function () {
      controls.forEach(function (el, i) {
        if (el.type === 'checkbox') el.checked = initial[i] === '1';
        else el.value = initial[i];
      });
      syncChips();
      fillModels();
      update();
    });

    // ── Review: the server's reading of the form ────────────────────
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
      });
    }
    var reviewSeq = 0;
    function loadReview() {
      if (!reviewList) return;
      var seq = ++reviewSeq;
      var body = new URLSearchParams(new FormData(form));
      body.set('preview', '1');
      fetch(form.getAttribute('action'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch', 'Accept': 'application/json' },
        body: body.toString()
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (seq !== reviewSeq) return;
          var out = '';
          (data.errors || []).forEach(function (e) { out += '<p class="settings-review__error" role="alert">' + esc(e) + '</p>'; });
          var changes = data.changes || [];
          if (changes.length) {
            out += '<ul class="settings-review">';
            changes.forEach(function (c) {
              out += '<li class="settings-review__row"><span class="settings-review__what">' + esc(c.what) + '</span>'
                + '<span><del class="settings-review__before">' + esc(c.before) + '</del> → <ins class="settings-review__after">' + esc(c.after) + '</ins></span></li>';
            });
            out += '</ul>';
            out += '<p class="settings-hint">' + (data.versioned
              ? 'Saved as a new version; roll back any time from Versions.'
              : 'These don\\u2019t change what the agent does, so no new version.') + '</p>';
          } else if (!(data.errors || []).length) {
            out += '<p class="settings-hint">Nothing changes: these match what is saved.</p>';
          }
          reviewList.innerHTML = out;
        })
        .catch(function () {
          if (seq === reviewSeq) reviewList.innerHTML = '<p class="settings-review__error">Couldn\\u2019t load the review. Save still checks everything.</p>';
        });
    }
    if (reviewBtn) reviewBtn.addEventListener('click', function () {
      if (!reviewList) return;
      if (!reviewList.hidden) { closeReview(); return; }
      reviewList.hidden = false;
      reviewList.innerHTML = '<p class="settings-hint">Checking…</p>';
      reviewBtn.setAttribute('aria-expanded', 'true');
      reviewBtn.textContent = 'Hide';
      loadReview();
    });

    form.addEventListener('submit', function () { submitting = true; });
    window.addEventListener('beforeunload', function (e) {
      if (submitting || changedControls().length === 0) return;
      e.preventDefault();
      e.returnValue = '';
    });

    syncChips();
    update();
  })();
`;
