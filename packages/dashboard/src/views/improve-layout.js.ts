/**
 * Improve-layout wizard JS — multi-stage modal that asks the layout-
 * planner agent for a Pulse rearrangement.
 *
 * Stage flow:
 *   1. Open → fetch suggestions, render pill row.
 *   2. Pill click → fill focus textarea, highlight pill.
 *   3. Submit → POST /pulse/layout-plan, poll /pulse/layout-plan/:runId.
 *   4. Done → render top agents + containers + clarifying questions.
 *   5. Answer questions → "Update plan" re-runs with appended context.
 *   6. Apply → write containers JSON to localStorage; reload.
 *
 * Inlined into pages via layout.ts.
 */
export const IMPROVE_LAYOUT_JS = `
(function () {
  var btn = document.getElementById('improve-layout-btn');
  var modal = document.getElementById('improve-layout-modal');
  var content = document.getElementById('improve-layout-content');
  if (!btn || !modal || !content) return;

  var LAYOUT_KEY = 'sua-pulse-layout';
  var cachedAgentMetadata = null;
  var lastFocus = '';

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function closeModal() { modal.classList.remove('is-open'); }
  function readLayout() {
    try { return localStorage.getItem(LAYOUT_KEY) || ''; } catch (e) { return ''; }
  }

  btn.addEventListener('click', function () {
    modal.classList.add('is-open');
    loadSuggestions();
  });
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-close-improve-layout')) closeModal();
  });

  function loadSuggestions() {
    var pills = document.getElementById('improve-layout-pills');
    if (!pills) return;
    fetch('/pulse/layout-plan/suggestions', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentLayout: readLayout() }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok || !Array.isArray(data.suggestions)) {
        pills.innerHTML = '<span class="dim" style="font-size:var(--font-size-xs);">Could not load suggestions. You can still type your own focus below.</span>';
        return;
      }
      cachedAgentMetadata = data.agentMetadata || null;
      if (data.suggestions.length === 0) {
        pills.innerHTML = '<span class="dim" style="font-size:var(--font-size-xs);">No suggestions for this layout. Type your own focus below.</span>';
        return;
      }
      pills.innerHTML = '';
      data.suggestions.forEach(function (s) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn--sm';
        b.setAttribute('data-suggestion-id', s.id);
        b.setAttribute('data-suggestion-dynamic', s.dynamic ? '1' : '0');
        b.style.fontSize = 'var(--font-size-xs)';
        b.style.padding = 'var(--space-1) var(--space-2)';
        if (s.dynamic) { b.style.borderColor = 'var(--color-primary)'; }
        b.textContent = s.label;
        b.title = s.prompt;
        b.addEventListener('click', function () {
          var ta = document.getElementById('improve-layout-focus');
          if (ta) {
            ta.value = s.prompt;
            ta.focus();
          }
          var siblings = pills.querySelectorAll('button[data-suggestion-id]');
          for (var i = 0; i < siblings.length; i++) siblings[i].classList.remove('btn--primary');
          b.classList.add('btn--primary');
        });
        pills.appendChild(b);
      });
    })
    .catch(function () {
      pills.innerHTML = '<span class="dim" style="font-size:var(--font-size-xs);">Could not load suggestions.</span>';
    });
  }

  var submitBtn = document.getElementById('improve-layout-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', function () {
      var ta = document.getElementById('improve-layout-focus');
      var focus = ta ? ta.value.trim() : '';
      runPlanner(focus);
    });
  }

  function runPlanner(focus) {
    lastFocus = focus;
    var t0 = Date.now();
    var cancelled = false;
    var pollTimer = null;
    var runId = null;

    content.innerHTML =
      '<div style="padding:var(--space-4);">' +
      '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">' +
        '<div class="spinner"></div>' +
        '<div style="flex:1;"><div style="font-weight:var(--weight-medium);">Planning layout</div>' +
        '<div class="dim" style="font-size:var(--font-size-xs);" id="improve-phase">Starting...</div></div>' +
        '<div style="font-family:var(--font-mono);font-size:var(--font-size-lg);color:var(--color-text-muted);min-width:3rem;text-align:right;" id="improve-timer">0s</div>' +
      '</div>' +
      '<div style="text-align:right;"><button type="button" class="btn btn--ghost btn--sm" id="improve-cancel">Cancel</button></div></div>';

    var tickTimer = setInterval(function () {
      var s = Math.round((Date.now() - t0) / 1000);
      var te = document.getElementById('improve-timer'); if (te) te.textContent = s + 's';
    }, 1000);

    var cancelEl = document.getElementById('improve-cancel');
    if (cancelEl) cancelEl.addEventListener('click', function () {
      cancelled = true; clearInterval(tickTimer); clearTimeout(pollTimer); closeModal();
    });

    fetch('/pulse/layout-plan', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        focus: focus,
        currentLayout: readLayout(),
        agentMetadata: cachedAgentMetadata,
      }),
    })
    .then(function (r) { return r.json(); })
    .then(function (start) {
      if (!start.ok || !start.runId) {
        clearInterval(tickTimer);
        renderError({ message: start.error || 'Failed to start layout planner' });
        return;
      }
      runId = start.runId;

      function poll() {
        if (cancelled) return;
        fetch('/pulse/layout-plan/' + encodeURIComponent(runId), { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.ok) {
              clearInterval(tickTimer);
              renderError(data.error || 'Layout planner failed');
              return;
            }
            if (data.status === 'running') {
              var pe = document.getElementById('improve-phase');
              if (pe && data.phase) pe.textContent = data.phase;
              pollTimer = setTimeout(poll, 1500);
              return;
            }
            clearInterval(tickTimer);
            if (data.status === 'done' && data.plan) {
              renderPlan(data.plan);
            } else {
              renderError({
                message: data.error || 'Layout planner failed',
                validationErrors: Array.isArray(data.validationErrors) ? data.validationErrors : [],
                rawResult: typeof data.rawResult === 'string' ? data.rawResult : '',
              });
            }
          })
          .catch(function (e) {
            clearInterval(tickTimer);
            renderError({ message: 'Network error: ' + (e && e.message ? e.message : 'unknown') });
          });
      }
      pollTimer = setTimeout(poll, 800);
    })
    .catch(function (e) {
      clearInterval(tickTimer);
      renderError({ message: 'Network error: ' + (e && e.message ? e.message : 'unknown') });
    });
  }

  /**
   * Render the failure screen with a feedback textarea + Retry button.
   * \`info\` shape: { message, validationErrors?: string[], rawResult?: string }
   * On retry, the focus passed to the next planner run is:
   *   lastFocus
   *   + "Previous attempt failed validation:\\n  - <error>\\n  - <error>"
   *   + "User feedback:\\n  <textarea value>"
   * so the LLM sees exactly which schema rules it broke + the user's
   * suggested correction.
   */
  function renderError(info) {
    if (typeof info === 'string') info = { message: info };
    var validation = Array.isArray(info.validationErrors) ? info.validationErrors : [];
    var rawResult = typeof info.rawResult === 'string' ? info.rawResult : '';

    var errorBlock =
      '<pre style="white-space:pre-wrap;font-size:var(--font-size-xs);color:var(--color-text-muted);background:var(--color-surface-raised);padding:var(--space-3);border-radius:var(--radius-sm);max-height:30vh;overflow:auto;margin:0;">' + esc(info.message || 'Layout planner failed') + '</pre>';

    var validationBlock = '';
    if (validation.length > 0) {
      var listItems = validation.map(function (v) { return '<li style="margin:0;">' + esc(v) + '</li>'; }).join('');
      validationBlock =
        '<div style="margin-top:var(--space-3);">' +
        '<div style="font-size:var(--font-size-xs);font-weight:var(--weight-semibold);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:var(--space-1);">Schema issues</div>' +
        '<ul style="margin:0;padding-left:var(--space-4);font-family:var(--font-mono);font-size:var(--font-size-xs);">' + listItems + '</ul></div>';
    }

    var rawBlock = '';
    if (rawResult) {
      rawBlock =
        '<details style="margin-top:var(--space-3);">' +
        '<summary class="dim" style="cursor:pointer;font-size:var(--font-size-xs);">Show raw planner output</summary>' +
        '<pre style="white-space:pre-wrap;font-size:var(--font-size-xs);background:var(--color-surface-raised);padding:var(--space-2);border-radius:var(--radius-sm);max-height:30vh;overflow:auto;margin-top:var(--space-1);">' + esc(rawResult) + '</pre></details>';
    }

    // Pre-fill the feedback textarea with the validation issues as a hint
    // so the user has signal about what to ask the planner to change.
    var prefill = validation.length > 0
      ? 'The previous plan had these schema issues:\\n' + validation.map(function (v) { return '  - ' + v; }).join('\\n') + '\\n\\nFix them by '
      : '';

    content.innerHTML =
      '<div style="padding:var(--space-4);">' +
      '<h3 style="margin:0 0 var(--space-3);">Layout planning failed</h3>' +
      errorBlock +
      validationBlock +
      rawBlock +
      '<div style="margin-top:var(--space-4);padding-top:var(--space-3);border-top:1px solid var(--color-border);">' +
      '<label style="display:flex;flex-direction:column;gap:var(--space-1);">' +
      '<strong style="font-size:var(--font-size-sm);">Feedback for the planner <span class="dim" style="font-weight:var(--weight-regular);">(optional)</span></strong>' +
      '<textarea id="improve-retry-feedback" rows="4" style="padding:var(--space-2) var(--space-3);border:1px solid var(--color-border-strong);border-radius:var(--radius-sm);font-size:var(--font-size-sm);resize:vertical;font-family:inherit;" placeholder="Tell the planner what to fix or do differently...">' + esc(prefill) + '</textarea>' +
      '</label>' +
      '<div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-3);">' +
      '<button type="button" class="btn btn--ghost btn--sm" data-close-improve-layout="1">Close</button>' +
      '<button type="button" class="btn btn--primary btn--sm" id="improve-retry-btn">Retry with feedback</button>' +
      '</div></div></div>';

    var retryBtn = document.getElementById('improve-retry-btn');
    if (retryBtn) retryBtn.addEventListener('click', function () {
      var ta = document.getElementById('improve-retry-feedback');
      var feedback = ta ? (ta.value || '').trim() : '';
      // Build the next focus: original + validation context + user feedback.
      // Skip the validation block if the original error wasn't validation-shaped.
      var parts = [];
      if (lastFocus) parts.push(lastFocus);
      if (validation.length > 0) {
        parts.push('Previous attempt failed validation. Issues:\\n' + validation.map(function (v) { return '  - ' + v; }).join('\\n'));
      } else if (info.message) {
        parts.push('Previous attempt failed: ' + info.message);
      }
      if (feedback) parts.push('User feedback:\\n' + feedback);
      var combined = parts.join('\\n\\n');
      runPlanner(combined);
    });
  }

  function renderPlan(plan) {
    var topRows = (plan.topAgents || []).map(function (a, i) {
      return '<div style="display:flex;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);">' +
        '<div class="dim" style="font-family:var(--font-mono);font-size:var(--font-size-xs);min-width:1.5rem;text-align:right;">' + (i + 1) + '.</div>' +
        '<div style="flex:1;">' +
          '<div style="font-family:var(--font-mono);font-size:var(--font-size-sm);font-weight:var(--weight-semibold);">' + esc(a.id) + (a.suggestedSize ? ' <span class="dim" style="font-weight:var(--weight-regular);">(' + esc(a.suggestedSize) + ')</span>' : '') + '</div>' +
          '<div class="dim" style="font-size:var(--font-size-xs);">' + esc(a.rationale) + '</div>' +
        '</div></div>';
    }).join('');

    var containerRows = (plan.containers || []).map(function (c) {
      var tiles = (c.tiles || []).map(function (t) { return '<code style="font-size:var(--font-size-xs);background:var(--color-surface-raised);padding:0 var(--space-1);border-radius:var(--radius-sm);">' + esc(t) + '</code>'; }).join(' ');
      return '<div style="padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);">' +
        '<div style="font-weight:var(--weight-semibold);font-size:var(--font-size-sm);margin-bottom:var(--space-1);">' + esc(c.label) + ' <span class="dim" style="font-weight:var(--weight-regular);font-size:var(--font-size-xs);">(' + (c.tiles || []).length + ')</span></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:var(--space-1);">' + tiles + '</div></div>';
    }).join('');

    var questionsHtml = '';
    if (Array.isArray(plan.questions) && plan.questions.length > 0) {
      var qRows = plan.questions.map(function (q, qi) {
        var inputHtml;
        if (Array.isArray(q.options) && q.options.length > 0) {
          inputHtml = '<select class="input improve-q-input" data-q-index="' + qi + '" style="font-size:var(--font-size-sm);width:100%;">' +
            '<option value="">(pick one)</option>' +
            q.options.map(function (o) { return '<option value="' + esc(o) + '"' + (q.suggestedAnswer === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
            '</select>';
        } else {
          inputHtml = '<input type="text" class="input improve-q-input" data-q-index="' + qi + '" placeholder="' + esc(q.suggestedAnswer || '') + '" value="' + esc(q.suggestedAnswer || '') + '" style="font-size:var(--font-size-sm);width:100%;">';
        }
        return '<div style="margin-bottom:var(--space-3);">' +
          '<div style="font-size:var(--font-size-sm);margin-bottom:var(--space-1);">' + esc(q.text) + '</div>' +
          inputHtml + '</div>';
      }).join('');
      questionsHtml =
        '<div style="margin-top:var(--space-4);padding-top:var(--space-3);border-top:1px solid var(--color-border);">' +
        '<div style="font-size:var(--font-size-xs);color:var(--color-text-muted);font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:var(--space-2);">Clarifying questions</div>' +
        qRows +
        '<div style="text-align:right;"><button type="button" class="btn btn--ghost btn--sm" id="improve-update-btn">Update plan</button></div></div>';
    }

    content.innerHTML =
      '<div style="padding:var(--space-4);">' +
      '<h3 style="margin:0 0 var(--space-2);">Proposed layout</h3>' +
      '<p class="dim" style="font-size:var(--font-size-xs);margin:0 0 var(--space-3);">' + esc(plan.summary || '') + '</p>' +
      '<div style="font-size:var(--font-size-xs);color:var(--color-text-muted);font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:var(--space-1);">Top agents</div>' +
      '<div style="margin-bottom:var(--space-4);">' + topRows + '</div>' +
      '<div style="font-size:var(--font-size-xs);color:var(--color-text-muted);font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:var(--space-1);">Containers</div>' +
      '<div style="margin-bottom:var(--space-2);">' + containerRows + '</div>' +
      questionsHtml +
      '<div style="margin-top:var(--space-4);padding-top:var(--space-3);border-top:1px solid var(--color-border);display:flex;gap:var(--space-2);justify-content:flex-end;">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-close-improve-layout="1">Cancel</button>' +
        '<button type="button" class="btn btn--primary btn--sm" id="improve-apply-btn">Apply layout</button>' +
      '</div></div>';

    var applyBtn = document.getElementById('improve-apply-btn');
    if (applyBtn) applyBtn.addEventListener('click', function () { applyPlan(plan); });

    var updateBtn = document.getElementById('improve-update-btn');
    if (updateBtn) updateBtn.addEventListener('click', function () {
      // Append answered questions to lastFocus and re-run.
      var inputs = content.querySelectorAll('.improve-q-input');
      var lines = [];
      for (var i = 0; i < inputs.length; i++) {
        var v = (inputs[i].value || '').trim();
        if (!v) continue;
        var qIdx = parseInt(inputs[i].getAttribute('data-q-index') || '0', 10);
        var qText = (plan.questions && plan.questions[qIdx] && plan.questions[qIdx].text) || '';
        lines.push('Q: ' + qText + '\\nA: ' + v);
      }
      var combined = lastFocus + (lines.length ? '\\n\\nClarifications:\\n' + lines.join('\\n\\n') : '');
      runPlanner(combined);
    });
  }

  function applyPlan(plan) {
    // Convert plan.containers → sua-pulse-layout shape, write, reload.
    var existing;
    try { existing = JSON.parse(readLayout() || '{}'); } catch (e) { existing = {}; }
    var containerMap = {};
    if (existing && Array.isArray(existing.containers)) {
      existing.containers.forEach(function (c) { containerMap[(c.label || '').toLowerCase().trim()] = c; });
    }
    var next = {
      containers: (plan.containers || []).map(function (c, idx) {
        var key = (c.label || '').toLowerCase().trim();
        var prev = containerMap[key] || {};
        return {
          id: prev.id || ('c-' + key.replace(/[^a-z0-9]+/g, '-') + '-' + idx),
          label: c.label,
          tiles: Array.from(c.tiles || []),
        };
      }),
    };

    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch (e) { /* */ }

    // Best-effort telemetry; ignore the response.
    fetch('/pulse/layout-plan/commit', { method: 'POST', credentials: 'same-origin' }).catch(function () {});

    closeModal();
    window.location.reload();
  }
})();
`;
