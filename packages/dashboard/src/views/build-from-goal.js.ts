/**
 * Build from goal wizard JS: multi-stage modal for designing agents
 * AND dashboards from a prompt.
 *
 * Stage flow:
 *   1. Goal input (rendered server-side; this script only wires events)
 *   2. Polling (spinner + timer + phase messages)
 *   3. Plan review (NEW) — survey + new agents + dashboard + questions,
 *      with editable YAML per new agent
 *   4. Commit progress (handled by the Commit button)
 *   5. Redirect to the new dashboard or agent
 *
 * Inlined into pages via layout.ts.
 */
export const BUILD_FROM_GOAL_JS = `
  (function () {
    var btn = document.getElementById('build-from-goal-btn');
    var modal = document.getElementById('build-modal');
    var content = document.getElementById('build-modal-content');
    if (!btn || !modal || !content) return;

    function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function closeModal() { modal.classList.remove('is-open'); }

    btn.addEventListener('click', function () { modal.classList.add('is-open'); });

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-close-build')) closeModal();
    });

    var submitBtn = document.getElementById('build-submit-btn');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', function () {
      var goalEl = document.getElementById('build-goal');
      var focusEl = document.getElementById('build-focus');
      var goal = goalEl ? goalEl.value.trim() : '';
      if (!goal) { goalEl && goalEl.focus(); return; }
      var focus = focusEl ? focusEl.value.trim() : '';

      var t0 = Date.now();
      var cancelled = false;
      var pollTimer = null;
      var PHASES = [[0,'Planning...'],[10,'Surveying installed agents...'],[25,'Drafting new agents...'],[55,'Designing dashboard...'],[90,'Almost there...']];

      content.innerHTML =
        '<div style="padding:var(--space-4);">' +
        '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">' +
          '<div class="spinner"></div>' +
          '<div style="flex:1;"><div style="font-weight:var(--weight-medium);">Planning</div>' +
          '<div class="dim" style="font-size:var(--font-size-xs);" id="build-phase">Planning...</div></div>' +
          '<div style="font-family:var(--font-mono);font-size:var(--font-size-lg);color:var(--color-text-muted);min-width:3rem;text-align:right;" id="build-timer">0s</div>' +
        '</div>' +
        '<div style="height:4px;background:var(--color-border);border-radius:2px;overflow:hidden;margin-bottom:var(--space-3);">' +
          '<div id="build-bar" style="height:100%;background:var(--color-primary);border-radius:2px;width:0%;transition:width 1s linear;"></div>' +
        '</div>' +
        '<div style="text-align:right;"><button type="button" class="btn btn--ghost btn--sm" id="build-cancel">Cancel</button></div></div>';

      var serverPhase = '';
      var tickTimer = setInterval(function () {
        var s = Math.round((Date.now() - t0) / 1000);
        var te = document.getElementById('build-timer'); if (te) te.textContent = s + 's';
        var be = document.getElementById('build-bar'); if (be) be.style.width = Math.min(s/120*100, 98) + '%';
        if (!serverPhase) {
          var pe = document.getElementById('build-phase'); if (pe) {
            var m = PHASES[0][1]; for (var i = 0; i < PHASES.length; i++) { if (s >= PHASES[i][0]) m = PHASES[i][1]; }
            pe.textContent = m;
          }
        }
      }, 1000);

      var ce = document.getElementById('build-cancel');
      if (ce) ce.addEventListener('click', function () { cancelled = true; clearInterval(tickTimer); clearTimeout(pollTimer); closeModal(); });

      fetch('/agents/build', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'goal=' + encodeURIComponent(goal) + (focus ? '&focus=' + encodeURIComponent(focus) : ''),
      })
      .then(function (r) { return r.json(); })
      .then(function (startData) {
        if (!startData.ok || !startData.runId) {
          clearInterval(tickTimer);
          renderError(startData.error || 'Failed to start planner');
          return;
        }
        var runId = startData.runId;

        function poll() {
          if (cancelled) return;
          fetch('/agents/build/' + encodeURIComponent(runId), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (cancelled) return;
              if (data.status === 'running') {
                if (data.phase) {
                  serverPhase = data.phase;
                  var pe = document.getElementById('build-phase');
                  if (pe) pe.textContent = data.phase;
                }
                pollTimer = setTimeout(poll, 2000);
              } else if (data.status === 'done' && data.plan) {
                clearInterval(tickTimer);
                renderPlanReview(data.plan);
              } else if (data.status === 'done' && data.yaml) {
                // Legacy single-YAML response (agent-builder fallback). Wrap it
                // in a one-agent plan and reuse the review UI.
                clearInterval(tickTimer);
                renderPlanReview({
                  intent: 'agent',
                  summary: data.agentName ? 'Build agent: ' + data.agentName : 'Build a new agent',
                  survey: { matchedAgents: [], missingFor: [], existingDashboards: [] },
                  newAgents: [{ id: data.agentId || 'new-agent', purpose: '', yaml: data.yaml }],
                  dashboard: null,
                  questions: [],
                });
              } else {
                clearInterval(tickTimer);
                renderError(data.error || 'Build failed');
              }
            })
            .catch(function () { if (!cancelled) pollTimer = setTimeout(poll, 3000); });
        }
        pollTimer = setTimeout(poll, 2000);
      })
      .catch(function (err) {
        clearInterval(tickTimer);
        renderError(String(err));
      });

      function renderError(msg) {
        content.innerHTML = '<div class="flash flash--error">' + esc(msg) + '</div>' +
          '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-build="1">Close</button></div>';
      }

      function renderPlanReview(plan) {
        var h = '';
        var intentLabel = {
          'agent': 'Agent',
          'dashboard-existing': 'Dashboard (existing agents)',
          'dashboard-new': 'Dashboard (new agents)',
          'dashboard-mixed': 'Dashboard (mixed)',
        }[plan.intent] || plan.intent;

        h += '<div style="display:flex;align-items:baseline;gap:var(--space-2);margin-bottom:var(--space-2);">' +
             '<h3 style="margin:0;">Plan ready</h3>' +
             '<span class="badge dim" style="font-size:var(--font-size-xs);">' + esc(intentLabel) + '</span>' +
             '</div>';
        h += '<p style="margin:0 0 var(--space-3);font-size:var(--font-size-sm);">' + esc(plan.summary) + '</p>';

        // Survey block
        var s = plan.survey || {};
        var surveyBits = [];
        if (s.matchedAgents && s.matchedAgents.length) {
          surveyBits.push('<div><span class="dim">Already have:</span> ' +
            s.matchedAgents.map(function (m) {
              return '<code>' + esc(m.id) + '</code> <span class="dim" style="font-size:var(--font-size-xs);">(' + esc(m.matchedFor) + ')</span>';
            }).join(', ') + '</div>');
        }
        if (s.missingFor && s.missingFor.length) {
          surveyBits.push('<div><span class="dim">Missing:</span> ' +
            s.missingFor.map(function (m) { return esc(m); }).join(', ') + '</div>');
        }
        if (s.existingDashboards && s.existingDashboards.length) {
          surveyBits.push('<div><span class="dim">Existing dashboards:</span> ' +
            s.existingDashboards.map(function (d) {
              return '<code>' + esc(d.id) + '</code> <span class="dim" style="font-size:var(--font-size-xs);">(' + esc(d.reason) + ')</span>';
            }).join(', ') + '</div>');
        }
        if (surveyBits.length) {
          h += '<div class="card" style="padding:var(--space-2) var(--space-3);margin-bottom:var(--space-3);font-size:var(--font-size-xs);display:flex;flex-direction:column;gap:var(--space-1);">' +
               surveyBits.join('') + '</div>';
        }

        // New agents — each as a collapsible card with editable YAML textarea
        if (plan.newAgents && plan.newAgents.length) {
          h += '<div style="margin-bottom:var(--space-3);">' +
               '<div class="dim" style="font-size:var(--font-size-xs);font-weight:var(--weight-semibold);margin-bottom:var(--space-2);">New agents to create (' + plan.newAgents.length + ')</div>';
          for (var i = 0; i < plan.newAgents.length; i++) {
            var a = plan.newAgents[i];
            h += '<details ' + (i === 0 ? 'open' : '') + ' style="margin-bottom:var(--space-2);">' +
                 '<summary style="cursor:pointer;padding:var(--space-1) 0;font-size:var(--font-size-sm);">' +
                 '<code>' + esc(a.id) + '</code> <span class="dim" style="font-size:var(--font-size-xs);">' + esc(a.purpose) + '</span></summary>' +
                 '<textarea data-new-agent-idx="' + i + '" rows="12" ' +
                 'style="width:100%;padding:var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);' +
                 'font-family:var(--font-mono);font-size:var(--font-size-xs);resize:vertical;line-height:1.5;tab-size:2;">' +
                 esc(a.yaml) + '</textarea></details>';
          }
          h += '</div>';
        }

        // Dashboard preview
        if (plan.dashboard) {
          h += '<div class="card" style="padding:var(--space-3);margin-bottom:var(--space-3);">' +
               '<div style="font-weight:var(--weight-semibold);margin-bottom:var(--space-2);">Dashboard: ' + esc(plan.dashboard.name) + ' <span class="dim" style="font-size:var(--font-size-xs);font-weight:normal;">(' + esc(plan.dashboard.id) + ')</span></div>';
          for (var j = 0; j < plan.dashboard.sections.length; j++) {
            var sec = plan.dashboard.sections[j];
            h += '<div style="font-size:var(--font-size-xs);margin-top:var(--space-1);"><strong>' + esc(sec.title) + ':</strong> ' +
                 sec.agentIds.map(function (id) { return '<code>' + esc(id) + '</code>'; }).join(', ') + '</div>';
          }
          h += '</div>';
        }

        // Questions block
        if (plan.questions && plan.questions.length) {
          h += '<div class="card card--muted" style="padding:var(--space-2) var(--space-3);margin-bottom:var(--space-3);font-size:var(--font-size-xs);">' +
               '<div class="dim" style="font-weight:var(--weight-semibold);margin-bottom:var(--space-1);">Questions</div>';
          for (var k = 0; k < plan.questions.length; k++) {
            var q = plan.questions[k];
            h += '<div style="margin-top:var(--space-1);">• ' + esc(q.text);
            if (q.suggestedAnswer) h += ' <span class="dim">(suggested: ' + esc(q.suggestedAnswer) + ')</span>';
            h += '</div>';
          }
          h += '<div class="dim" style="margin-top:var(--space-2);font-size:var(--font-size-xs);">To answer, append your reply to the goal and re-run.</div>' +
               '</div>';
        }

        h += '<div id="build-result-flash"></div>';
        h += '<div style="display:flex;gap:var(--space-2);justify-content:flex-end;flex-wrap:wrap;">' +
             '<button type="button" class="btn btn--ghost btn--sm" data-close-build="1">Dismiss</button>' +
             '<button type="button" class="btn btn--primary btn--sm" id="build-commit-btn">' +
             (plan.dashboard ? 'Create dashboard + ' + (plan.newAgents.length || 0) + ' agent(s)' :
              plan.newAgents.length === 1 ? 'Create agent' :
              'Create ' + plan.newAgents.length + ' agents') +
             '</button></div>';
        content.innerHTML = h;

        // Stash the plan so commit can rebuild it with edited YAMLs.
        wireCommit(plan);
      }

      function wireCommit(plan) {
        var commitBtn = document.getElementById('build-commit-btn');
        if (!commitBtn) return;
        commitBtn.addEventListener('click', function () {
          // Pull the latest YAML edits out of each new-agent textarea.
          var editedNewAgents = (plan.newAgents || []).map(function (a, i) {
            var ta = document.querySelector('[data-new-agent-idx="' + i + '"]');
            return { id: a.id, purpose: a.purpose, yaml: ta ? ta.value : a.yaml };
          });
          var payload = {
            plan: Object.assign({}, plan, { newAgents: editedNewAgents }),
            plannerRunId: runId,
          };

          commitBtn.disabled = true;
          commitBtn.textContent = 'Creating...';
          var flashEl = document.getElementById('build-result-flash');
          if (flashEl) flashEl.innerHTML = '';

          fetch('/agents/build/commit', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          .then(function (r) { return r.json(); })
          .then(function (result) {
            if (!result.ok) {
              commitBtn.disabled = false;
              commitBtn.textContent = 'Commit';
              if (flashEl) flashEl.innerHTML = '<div class="flash flash--error" style="margin-bottom:var(--space-3);font-size:var(--font-size-xs);">' + esc(result.error || 'Commit failed') + '</div>';
              return;
            }
            // Render a brief summary then redirect.
            var summary = '';
            if (result.agentsCreated && result.agentsCreated.length) {
              summary += '<div>Created ' + result.agentsCreated.length + ' agent(s): <code>' + result.agentsCreated.map(esc).join('</code>, <code>') + '</code></div>';
            }
            if (result.agentsSkipped && result.agentsSkipped.length) {
              summary += '<div class="dim" style="margin-top:var(--space-1);">Skipped ' + result.agentsSkipped.length + ': ' +
                result.agentsSkipped.map(function (s) { return esc(s.id) + ' (' + esc(s.reason) + ')'; }).join('; ') + '</div>';
            }
            if (result.dashboardCreated) {
              summary += '<div>Created dashboard: <code>' + esc(result.dashboardCreated) + '</code></div>';
            }
            if (result.dashboardError) {
              summary += '<div class="dim" style="color:var(--color-danger,#a00);">Dashboard error: ' + esc(result.dashboardError) + '</div>';
            }
            content.innerHTML = '<div style="padding:var(--space-3);">' +
              '<h3 style="margin:0 0 var(--space-2);">Done</h3>' +
              '<div style="font-size:var(--font-size-sm);">' + summary + '</div>' +
              '<div class="dim" style="margin-top:var(--space-3);font-size:var(--font-size-xs);">Redirecting in 1.5s...</div>' +
              '</div>';
            setTimeout(function () { window.location.href = result.redirectUrl || '/agents'; }, 1500);
          })
          .catch(function (err) {
            commitBtn.disabled = false;
            commitBtn.textContent = 'Commit';
            if (flashEl) flashEl.innerHTML = '<div class="flash flash--error">' + esc(String(err)) + '</div>';
          });
        });
      }
    });
  })();
`;
