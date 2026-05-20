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

  // Surface-specific config — set on the modal element by the view
  // helper. Pulse uses /pulse/layout-plan + sua-pulse-layout + "hide".
  // Each named dashboard uses /dashboards/<id>/layout-plan +
  // sua-dashboard-layout-<id> + "remove".
  var ENDPOINT_BASE = modal.getAttribute('data-endpoint-base') || '/pulse/layout-plan';
  var LAYOUT_KEY = modal.getAttribute('data-storage-key') || 'sua-pulse-layout';
  var CURATE_VERB = modal.getAttribute('data-curate-verb') || 'hide';
  var CURATE_PAST = CURATE_VERB === 'remove' ? 'removed' : 'hidden';
  var CURATE_BUCKET = CURATE_VERB === 'remove' ? 'this dashboard' : 'Pulse';
  var cachedAgentMetadata = null;
  var lastFocus = '';
  // Auto-retry budget for schema-validation failures. Reset each time
  // the user explicitly invokes the planner (submit / refine / draft
  // hand-off); we only auto-retry inside the same user-initiated run
  // to avoid infinite loops when the LLM can't satisfy the schema.
  var validationRetriesLeft = 0;
  var AUTO_RETRY_BUDGET = 1;

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function closeModal() { modal.classList.remove('is-open'); }
  function readLayout() {
    try { return localStorage.getItem(LAYOUT_KEY) || ''; } catch (e) { return ''; }
  }

  // ── Build-from-goal hand-off ────────────────────────────────────────
  //
  // When the planner emits needsNew[], the wizard hands off to
  // build-from-goal so the user gets the full critic loop. We persist
  // enough state in sessionStorage that build-from-goal can call us
  // back when its commit succeeds; on resume, the user sees the
  // original plan with the freshly drafted agents merged in and only
  // needs to click Apply layout.
  var HANDOFF_KEY = 'sua-layout-handoff-v1';
  var HANDOFF_TTL_MS = 60 * 60 * 1000; // 1h

  function buildGoalFromNeedsNew(needsNew) {
    var lines = needsNew.map(function (n, i) {
      var name = n.suggestedName ? n.suggestedName + ' — ' : '';
      return (i + 1) + '. ' + name + n.purpose;
    }).join('\\n');
    var bucket = CURATE_VERB === 'remove' ? 'this dashboard' : 'my Pulse layout';
    return 'Create these agents for ' + bucket + ':\\n\\n' + lines +
      '\\n\\nEach agent must declare a Pulse signal (metric, status, or another template) so it can render as a tile.';
  }

  function handoffToBuildFromGoal(plan, needsNew) {
    if (!Array.isArray(needsNew) || needsNew.length === 0) return;
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
        endpointBase: ENDPOINT_BASE,
        storageKey: LAYOUT_KEY,
        curateVerb: CURATE_VERB,
        originalPlan: plan,
        originalFocus: lastFocus || '',
        createdAt: Date.now(),
      }));
    } catch (e) { /* sessionStorage may be unavailable */ }

    closeModal();

    // Open the build-from-goal modal. The button is rendered hidden
    // on /pulse and /dashboards/:id pages — click it to open the modal,
    // then fill in the goal + force agents-only target.
    var trigger = document.getElementById('build-from-goal-btn');
    if (!trigger) {
      // Page doesn't host the build modal — fall back to navigation.
      // Shouldn't happen on Pulse/dashboard pages, but be defensive.
      window.location.href = '/agents';
      return;
    }
    trigger.click();

    // Defer DOM mutation so the modal markup is fully visible first.
    setTimeout(function () {
      var ta = document.getElementById('build-goal');
      if (ta) ta.value = buildGoalFromNeedsNew(needsNew);
      // Force "Just create the agent(s)" — we're not making a new
      // dashboard from this flow.
      var radio = document.querySelector('input[name="build-target"][value="agents"]');
      if (radio) {
        radio.checked = true;
        // Trigger any UI sync (e.g. hiding the dashboard-picker row).
        try { radio.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      }
      if (ta) ta.focus();
    }, 50);
  }

  function readHandoff() {
    var raw = null;
    try { raw = sessionStorage.getItem(HANDOFF_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (Date.now() - (parsed.createdAt || 0) > HANDOFF_TTL_MS) return null;
      return parsed;
    } catch (e) { return null; }
  }

  function clearHandoff() {
    try { sessionStorage.removeItem(HANDOFF_KEY); } catch (e) {}
  }

  function mergePlanWithDraftedAgents(plan, createdIds) {
    if (!createdIds.length) return plan;
    var p = JSON.parse(JSON.stringify(plan));
    p.toAdd = (p.toAdd || []).slice();
    for (var i = 0; i < createdIds.length; i++) {
      if (p.toAdd.indexOf(createdIds[i]) === -1) p.toAdd.push(createdIds[i]);
    }
    // Place freshly drafted agents in a new container at the end so the
    // user can see exactly what was added and shuffle them later via
    // edit-layout. Don't try to be clever about which existing container
    // they "belong" to — that's the next planner run's job.
    p.containers = (p.containers || []).slice();
    p.containers.push({ label: 'Newly drafted', tiles: createdIds.slice() });
    p.needsNew = [];
    p.summary = (p.summary || '') + ' Drafted ' + createdIds.length + ' new agent' +
      (createdIds.length === 1 ? '' : 's') + ' (' + createdIds.join(', ') + ').';
    return p;
  }

  // Listen for build-from-goal's resume signal. The event fires on the
  // current page (we never navigate during hand-off), so we just
  // re-open and re-render.
  window.addEventListener('sua:resume-layout', function (ev) {
    var detail = (ev && ev.detail) || {};
    var handoff = detail.handoff;
    var created = Array.isArray(detail.agentsCreated) ? detail.agentsCreated : [];
    if (!handoff || handoff.endpointBase !== ENDPOINT_BASE) return;
    var merged = mergePlanWithDraftedAgents(handoff.originalPlan, created);
    lastFocus = handoff.originalFocus || '';
    modal.classList.add('is-open');
    renderPlan(merged);
    clearHandoff();
  });

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
    fetch(ENDPOINT_BASE + '/suggestions', {
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
      validationRetriesLeft = AUTO_RETRY_BUDGET;
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

    fetch(ENDPOINT_BASE, {
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
        fetch(ENDPOINT_BASE + '/' + encodeURIComponent(runId), { credentials: 'same-origin' })
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
              var ve = Array.isArray(data.validationErrors) ? data.validationErrors : [];
              // Auto-retry once on schema-validation failures: append the
              // errors as feedback and re-run silently. Saves the user
              // from seeing the error UI when the planner can fix the
              // issue itself (typo'd ids, missing rationales, etc.).
              if (ve.length > 0 && validationRetriesLeft > 0) {
                validationRetriesLeft -= 1;
                var nextFocus = lastFocus
                  ? lastFocus + '\\n\\nPrevious attempt failed validation. Fix these issues:\\n' + ve.map(function (m) { return '  - ' + m; }).join('\\n')
                  : 'Previous attempt failed validation. Fix these issues:\\n' + ve.map(function (m) { return '  - ' + m; }).join('\\n');
                runPlanner(nextFocus);
                return;
              }
              renderError({
                message: data.error || 'Layout planner failed',
                validationErrors: ve,
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
      validationRetriesLeft = AUTO_RETRY_BUDGET;
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
        '</div>';
    }

    // Always-available "refine this plan" block. Lets the user redirect
    // the planner ("don't suggest stock-ticker", "go more educational",
    // "drop crypto") without backing out to the original FOCUS textarea.
    // Sits just above the action row. The button re-runs the planner
    // with combined context: original FOCUS + answered questions +
    // freeform refinement.
    var refineHtml =
      '<div style="margin-top:var(--space-4);padding-top:var(--space-3);border-top:1px solid var(--color-border);">' +
      '<label style="display:flex;flex-direction:column;gap:var(--space-1);">' +
        '<strong style="font-size:var(--font-size-sm);">Refine this plan <span class="dim" style="font-weight:var(--weight-regular);font-size:var(--font-size-xs);">(optional — redirect the planner before applying)</span></strong>' +
        '<textarea id="improve-refine-feedback" rows="2" style="padding:var(--space-2) var(--space-3);border:1px solid var(--color-border-strong);border-radius:var(--radius-sm);font-size:var(--font-size-sm);resize:vertical;font-family:inherit;" placeholder="e.g. drop stock-ticker, suggest educational agents instead"></textarea>' +
      '</label>' +
      '<div style="text-align:right;margin-top:var(--space-2);"><button type="button" class="btn btn--ghost btn--sm" id="improve-update-btn">Update plan</button></div>' +
      '</div>';

    // Compute which agents will be hidden: every MEMBER agent that
    // isn't referenced by any container (system tiles excluded).
    // Available agents aren't "hidden" if un-surfaced — they were
    // never on this surface to begin with.
    var surfacedSet = {};
    (plan.containers || []).forEach(function (c) {
      (c.tiles || []).forEach(function (t) {
        if (typeof t === 'string' && t.charAt(0) !== '_') surfacedSet[t] = true;
      });
    });
    var willHide = [];
    if (Array.isArray(cachedAgentMetadata)) {
      for (var hi = 0; hi < cachedAgentMetadata.length; hi++) {
        var ai = cachedAgentMetadata[hi];
        if (!ai || !ai.id || ai.available) continue;
        if (!surfacedSet[ai.id]) willHide.push(ai.id);
      }
    }

    // willAdd: the plan's toAdd[] — installed-but-not-here agents
    // being brought onto this surface. Falls back to inferring from
    // container membership when toAdd is empty (older plans).
    var willAdd = [];
    if (Array.isArray(plan.toAdd) && plan.toAdd.length > 0) {
      willAdd = plan.toAdd.filter(function (id) { return typeof id === 'string' && id.charAt(0) !== '_'; });
    } else if (Array.isArray(cachedAgentMetadata)) {
      for (var ai2 = 0; ai2 < cachedAgentMetadata.length; ai2++) {
        var m = cachedAgentMetadata[ai2];
        if (m && m.available && m.id && surfacedSet[m.id]) willAdd.push(m.id);
      }
    }
    // needsNew: brand-new agents the planner thinks should exist but
    // don't. These can't be committed inline — the user has to draft
    // them in Build from goal. Render a "Draft these agents" section
    // with a link out to /agents.
    var needsNew = Array.isArray(plan.needsNew) ? plan.needsNew.filter(function (n) {
      return n && typeof n === 'object' && typeof n.purpose === 'string' && n.purpose.length > 0;
    }) : [];
    var needsNewHtml = '';
    if (needsNew.length > 0) {
      var needsNewRows = needsNew.map(function (n) {
        var name = n.suggestedName ? '<code style="font-size:var(--font-size-xs);background:var(--color-surface-raised);padding:0 var(--space-1);border-radius:var(--radius-sm);">' + esc(n.suggestedName) + '</code> ' : '';
        return '<li style="margin-bottom:var(--space-2);">' + name + '<span style="font-size:var(--font-size-sm);">' + esc(n.purpose) + '</span></li>';
      }).join('');
      needsNewHtml =
        '<div style="margin:var(--space-3) 0;padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface-raised);">' +
        '<div style="font-weight:var(--weight-semibold);font-size:var(--font-size-sm);margin-bottom:var(--space-2);">' + needsNew.length + ' new agent' + (needsNew.length === 1 ? '' : 's') + ' to draft <span class="dim" style="font-weight:var(--weight-regular);font-size:var(--font-size-xs);">(these don\\'t exist yet)</span></div>' +
        '<ul style="margin:0;padding-left:var(--space-4);">' + needsNewRows + '</ul>' +
        '<div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-top:var(--space-2);">Choose "Draft + apply" below to open Build from goal (full critic loop); you\\'ll come back here to apply the layout.</div>' +
        '</div>';
    }

    var willAddHtml = '';
    if (willAdd.length > 0) {
      var addList = willAdd.map(function (id) { return '<code style="font-size:var(--font-size-xs);background:var(--color-surface-raised);padding:0 var(--space-1);border-radius:var(--radius-sm);">' + esc(id) + '</code>'; }).join(' ');
      var addBucket = CURATE_VERB === 'remove' ? 'this dashboard' : 'Pulse';
      willAddHtml =
        '<details style="margin:var(--space-3) 0;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface-raised);">' +
        '<summary style="cursor:pointer;font-size:var(--font-size-sm);">' +
        '<strong>Will add ' + willAdd.length + ' agent' + (willAdd.length === 1 ? '' : 's') + ' to ' + addBucket + '</strong> ' +
        '<span class="dim" style="font-weight:var(--weight-regular);font-size:var(--font-size-xs);">' +
          '(installed but not yet on this surface)' +
        '</span>' +
        '</summary>' +
        '<div style="display:flex;flex-wrap:wrap;gap:var(--space-1);margin-top:var(--space-2);">' + addList + '</div></details>';
    }

    var willHideHtml = '';
    if (willHide.length > 0) {
      var hideList = willHide.map(function (id) { return '<code style="font-size:var(--font-size-xs);background:var(--color-surface-raised);padding:0 var(--space-1);border-radius:var(--radius-sm);">' + esc(id) + '</code>'; }).join(' ');
      willHideHtml =
        '<details style="margin:var(--space-3) 0;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface-raised);">' +
        '<summary style="cursor:pointer;font-size:var(--font-size-sm);">' +
        '<strong>Will ' + CURATE_VERB + ' ' + willHide.length + ' agent' + (willHide.length === 1 ? '' : 's') + '</strong> ' +
        '<span class="dim" style="font-weight:var(--weight-regular);font-size:var(--font-size-xs);">' +
          (CURATE_VERB === 'remove'
            ? '(removed from this dashboard\\'s sections — restore with the Add tile button)'
            : '(restore from the "hidden signals" section after applying)') +
        '</span>' +
        '</summary>' +
        '<div style="display:flex;flex-wrap:wrap;gap:var(--space-1);margin-top:var(--space-2);">' + hideList + '</div></details>';
    }

    // When the planner emits needsNew[], Draft+apply becomes the primary
    // CTA (the user explicitly asked for new agents — Apply layout
    // alone would skip them). Apply layout stays as the escape hatch
    // for users who decide to skip drafting.
    var hasNeedsNew = needsNew.length > 0;
    var draftBtnHtml = hasNeedsNew
      ? '<button type="button" class="btn btn--primary btn--sm" id="improve-draft-btn">Draft ' + needsNew.length + ' agent' + (needsNew.length === 1 ? '' : 's') + ' + apply</button>'
      : '';
    var applyBtnClass = hasNeedsNew ? 'btn btn--ghost btn--sm' : 'btn btn--primary btn--sm';

    content.innerHTML =
      '<div style="padding:var(--space-4);">' +
      '<h3 style="margin:0 0 var(--space-2);">Proposed layout</h3>' +
      '<p class="dim" style="font-size:var(--font-size-xs);margin:0 0 var(--space-3);">' + esc(plan.summary || '') + '</p>' +
      '<div style="font-size:var(--font-size-xs);color:var(--color-text-muted);font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:var(--space-1);">Top agents</div>' +
      '<div style="margin-bottom:var(--space-4);">' + topRows + '</div>' +
      '<div style="font-size:var(--font-size-xs);color:var(--color-text-muted);font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:var(--space-1);">Containers</div>' +
      '<div style="margin-bottom:var(--space-2);">' + containerRows + '</div>' +
      willAddHtml +
      willHideHtml +
      needsNewHtml +
      questionsHtml +
      refineHtml +
      '<div style="margin-top:var(--space-4);padding-top:var(--space-3);border-top:1px solid var(--color-border);display:flex;gap:var(--space-2);justify-content:flex-end;align-items:center;">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-close-improve-layout="1">Cancel</button>' +
        '<button type="button" class="' + applyBtnClass + '" id="improve-apply-btn">Apply layout' + (hasNeedsNew ? ' only' : '') + '</button>' +
        draftBtnHtml +
      '</div></div>';

    var applyBtn = document.getElementById('improve-apply-btn');
    if (applyBtn) applyBtn.addEventListener('click', function () { applyPlan(plan); });

    var draftBtn = document.getElementById('improve-draft-btn');
    if (draftBtn) draftBtn.addEventListener('click', function () { handoffToBuildFromGoal(plan, needsNew); });

    var updateBtn = document.getElementById('improve-update-btn');
    if (updateBtn) updateBtn.addEventListener('click', function () {
      // Append answered questions + freeform refinement to lastFocus and re-run.
      var inputs = content.querySelectorAll('.improve-q-input');
      var lines = [];
      for (var i = 0; i < inputs.length; i++) {
        var v = (inputs[i].value || '').trim();
        if (!v) continue;
        var qIdx = parseInt(inputs[i].getAttribute('data-q-index') || '0', 10);
        var qText = (plan.questions && plan.questions[qIdx] && plan.questions[qIdx].text) || '';
        lines.push('Q: ' + qText + '\\nA: ' + v);
      }
      var refineEl = document.getElementById('improve-refine-feedback');
      var refine = refineEl ? (refineEl.value || '').trim() : '';
      var parts = [];
      if (lastFocus) parts.push(lastFocus);
      if (lines.length) parts.push('Clarifications:\\n' + lines.join('\\n\\n'));
      if (refine) parts.push('Refinement:\\n' + refine);
      validationRetriesLeft = AUTO_RETRY_BUDGET;
      runPlanner(parts.join('\\n\\n'));
    });
  }

  function applyPlan(plan) {
    // Build the localStorage layout JSON from the plan, preserving any
    // container ids that already existed under a matching label.
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

    // Tell the server to flip pulseVisible: hide anything not surfaced,
    // unhide anything previously hidden that's now in a container. This
    // is the curation half of "Apply". The layout (containers + tile
    // order) stays client-side in localStorage.
    var applyBtn = document.getElementById('improve-apply-btn');
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Applying...'; }

    fetch(ENDPOINT_BASE + '/commit', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ containers: plan.containers || [] }),
    })
    .then(function (r) { return r.json(); })
    .catch(function () { return {}; })
    .then(function () {
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch (e) { /* */ }
      closeModal();
      window.location.reload();
    });
  }
})();
`;
