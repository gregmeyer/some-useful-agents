/**
 * Build from goal wizard JS: multi-stage modal for designing agents from a prompt.
 *
 * Extracted from js.ts. Inlined via layout.ts.
 */
export const BUILD_FROM_GOAL_JS = `
  // ── Build from goal wizard ─────────────────────────────────────────
  // Modal wizard that designs a new agent from a prompt.
  (function () {
    var btn = document.getElementById('build-from-goal-btn');
    var modal = document.getElementById('build-modal');
    var content = document.getElementById('build-modal-content');
    if (!btn || !modal || !content) return;

    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
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
      var PHASES = [[0,'Designing agent...'],[5,'Selecting tools...'],[15,'Building node pipeline...'],[30,'Generating YAML...'],[60,'Still working...'],[90,'Almost there...']];

      content.innerHTML =
        '<div style="padding:var(--space-4);">' +
        '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">' +
          '<div class="spinner"></div>' +
          '<div style="flex:1;"><div style="font-weight:var(--weight-medium);">Building agent</div>' +
          '<div class="dim" style="font-size:var(--font-size-xs);" id="build-phase">Designing agent...</div></div>' +
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
        // Only use timer-based fallback phases when no server phase has arrived.
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
          content.innerHTML = '<div class="flash flash--error">' + esc(startData.error || 'Failed') + '</div>' +
            '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-build="1">Close</button></div>';
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
              } else if (data.status === 'done') {
                clearInterval(tickTimer);
                var h = '<h3 style="margin:0 0 var(--space-3);">Agent designed</h3>';
                if (data.agentName) h += '<p style="font-weight:var(--weight-medium);margin:0 0 var(--space-2);">' + esc(data.agentName) + ' <span class="dim">(' + esc(data.agentId) + ')</span></p>';
                if (data.yamlError) {
                  h += '<div class="flash flash--error" style="margin-bottom:var(--space-3);font-size:var(--font-size-xs);">' +
                    '<strong>Validation error:</strong> ' + esc(data.yamlError) +
                    '<br>Edit the YAML below to fix, then create.</div>';
                }
                if (data.yaml) {
                  h += '<label style="display:flex;flex-direction:column;gap:var(--space-1);margin-bottom:var(--space-3);">' +
                    '<span class="dim" style="font-size:var(--font-size-xs);font-weight:var(--weight-semibold);">Review and edit YAML before creating</span>' +
                    '<textarea id="build-yaml-editor" rows="15" ' +
                    'style="padding:var(--space-3);border:1px solid var(--color-border-strong);border-radius:var(--radius-sm);' +
                    'font-family:var(--font-mono);font-size:var(--font-size-xs);resize:vertical;line-height:1.5;tab-size:2;">' +
                    esc(data.yaml) + '</textarea></label>';
                }
                h += '<div id="build-result-flash"></div>';
                h += '<div style="display:flex;gap:var(--space-2);justify-content:flex-end;flex-wrap:wrap;">';
                if (data.yaml) {
                  h += '<button type="button" class="btn btn--primary btn--sm" id="build-create-btn">Create agent</button>';
                }
                h += '<button type="button" class="btn btn--ghost btn--sm" data-close-build="1">Dismiss</button></div>';
                content.innerHTML = h;

                var createBtn = document.getElementById('build-create-btn');
                if (createBtn) {
                  createBtn.addEventListener('click', function () {
                    var yamlEditor = document.getElementById('build-yaml-editor');
                    var yamlText = yamlEditor ? yamlEditor.value : '';
                    if (!yamlText.trim()) return;
                    createBtn.disabled = true;
                    createBtn.textContent = 'Creating...';
                    var flashEl = document.getElementById('build-result-flash');
                    if (flashEl) flashEl.innerHTML = '';
                    fetch('/agents/build/create', {
                      method: 'POST', credentials: 'same-origin',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ yaml: yamlText }),
                    })
                    .then(function (r) { return r.json(); })
                    .then(function (result) {
                      if (result.ok) {
                        window.location.href = '/agents/' + encodeURIComponent(result.agentId);
                      } else {
                        createBtn.disabled = false;
                        createBtn.textContent = 'Create agent';
                        // If agent already exists, show a link to it.
                        var msg = result.error || 'Creation failed';
                        var existsMatch = msg.match(/["']([a-z0-9][a-z0-9-]*)["'] already exists/i);
                        if (existsMatch && flashEl) {
                          flashEl.innerHTML = '<div class="flash flash--error" style="margin-bottom:var(--space-3);font-size:var(--font-size-xs);">' +
                            esc(msg) + ' <a href="/agents/' + encodeURIComponent(existsMatch[1]) + '" style="font-weight:var(--weight-semibold);">Open existing agent \\u2192</a></div>';
                        } else if (flashEl) {
                          flashEl.innerHTML = '<div class="flash flash--error" style="margin-bottom:var(--space-3);font-size:var(--font-size-xs);">' + esc(msg) + '</div>';
                        }
                      }
                    });
                  });
                }
              } else {
                clearInterval(tickTimer);
                content.innerHTML = '<div class="flash flash--error">' + esc(data.error || 'Build failed') + '</div>' +
                  '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-build="1">Close</button></div>';
              }
            })
            .catch(function () { if (!cancelled) pollTimer = setTimeout(poll, 3000); });
        }
        pollTimer = setTimeout(poll, 2000);
      })
      .catch(function (err) {
        clearInterval(tickTimer);
        content.innerHTML = '<div class="flash flash--error">' + esc(String(err)) + '</div>' +
          '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-build="1">Close</button></div>';
      });
    });
  })();
`;
