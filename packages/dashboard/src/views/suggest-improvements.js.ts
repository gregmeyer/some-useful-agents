/**
 * Suggest improvements modal JS: 3-stage modal (prompt → progress → colored diff).
 *
 * Extracted from js.ts. Inlined via layout.ts.
 */
export const SUGGEST_IMPROVEMENTS_JS = `
  // ── Suggest improvements modal ─────────────────────────────────────
  // Modal with progress feedback, cancel, colored diff.
  (function () {
    var btn = document.getElementById('suggest-btn');
    var modal = document.getElementById('suggest-modal');
    var content = document.getElementById('suggest-modal-content');
    if (!btn || !modal || !content) return;
    var agentId = btn.getAttribute('data-agent-id');
    var PHASES = [
      [0,'Sending YAML to Claude...'],[5,'Reading the DAG structure...'],
      [15,'Analyzing cross-node data flow...'],[30,'Generating suggestions...'],
      [60,'Still working (complex agent)...'],[90,'Almost there...']
    ];

    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function closeModal() { modal.classList.remove('is-open'); }

    // Lightweight markdown to HTML for analysis output.
    function renderMd(text) {
      var h = esc(text);
      h = h.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>' + '$' + '1</strong>');
      h = h.replace(/\\*(.+?)\\*/g, '<em>' + '$' + '1</em>');
      h = h.replace(/^- (.+)$/gm, function(m,p1) { return '<li style="margin-left:var(--space-4);list-style:disc;">' + p1 + '</li>'; });
      h = h.replace(/\\n{2,}/g, '<br><br>');
      h = h.replace(/\\n/g, '<br>');
      return h;
    }

    function coloredDiff(oldT, newT) {
      var oL = oldT.split('\\n'), nL = newT.split('\\n');
      var oS = {}, nS = {};
      for (var i = 0; i < oL.length; i++) oS[oL[i].trim()] = true;
      for (var j = 0; j < nL.length; j++) nS[nL[j].trim()] = true;
      var DEL = 'background:rgba(255,0,0,0.08);color:#cf222e;';
      var ADD = 'background:rgba(0,180,0,0.08);color:#1a7f37;';
      var P = 'font-size:var(--font-size-xs);background:var(--color-surface-raised);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:var(--space-3);max-height:280px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;margin:0;';
      var h = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-bottom:var(--space-3);">';
      h += '<div><p class="dim" style="font-size:var(--font-size-xs);margin:0 0 var(--space-1);">Current</p><pre style="' + P + '">';
      for (var a = 0; a < oL.length; a++) h += '<span style="display:block;' + (nS[oL[a].trim()] ? '' : DEL) + '">' + esc(oL[a]) + '</span>';
      h += '</pre></div><div><p class="dim" style="font-size:var(--font-size-xs);margin:0 0 var(--space-1);">Suggested</p><pre style="' + P + '">';
      for (var b = 0; b < nL.length; b++) h += '<span style="display:block;' + (oS[nL[b].trim()] ? '' : ADD) + '">' + esc(nL[b]) + '</span>';
      h += '</pre></div></div>';
      return h;
    }

    function renderResult(data) {
      var bc = data.classification === 'NO_IMPROVEMENTS' ? 'badge--ok' : data.classification === 'REWRITE' ? 'badge--err' : 'badge--warn';
      var bl = data.classification === 'NO_IMPROVEMENTS' ? 'No improvements needed' : data.classification === 'REWRITE' ? 'Recommend rewrite' : 'Suggested improvements';
      var h = '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);"><span class="badge ' + bc + '">' + esc(bl) + '</span></div>';
      if (data.summary) h += '<p style="font-weight:var(--weight-medium);margin:0 0 var(--space-3);">' + renderMd(data.summary) + '</p>';
      if (data.details) h += '<div style="font-size:var(--font-size-sm);line-height:1.6;margin:0 0 var(--space-3);color:var(--color-text-muted);max-height:250px;overflow-y:auto;">' + renderMd(data.details) + '</div>';
      if (data.yaml && data.currentYaml) {
        h += coloredDiff(data.currentYaml, data.yaml);
      } else if (data.yaml) {
        h += '<pre style="font-size:var(--font-size-xs);background:var(--color-surface-raised);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:var(--space-3);margin-bottom:var(--space-3);max-height:300px;overflow-y:auto;white-space:pre-wrap;">' + esc(data.yaml) + '</pre>';
      }
      if (data.yamlError) {
        h += '<div class="flash flash--error" style="margin-bottom:var(--space-3);font-size:var(--font-size-xs);">' +
          '<strong>YAML validation error:</strong> ' + esc(data.yamlError) + '</div>';
      }
      h += '<div style="display:flex;gap:var(--space-2);justify-content:flex-end;flex-wrap:wrap;">';
      if (data.yaml && !data.yamlError) {
        h += '<button type="button" class="btn btn--primary btn--sm" id="sg-apply-now">Apply now</button>';
        h += '<button type="button" class="btn btn--ghost btn--sm" id="sg-review">Review first</button>';
      } else if (data.yaml && data.yamlError) {
        h += '<button type="button" class="btn btn--primary btn--sm" id="sg-fix-ai">Fix with AI</button>';
        h += '<button type="button" class="btn btn--ghost btn--sm" id="sg-review">Edit manually</button>';
      }
      h += '<button type="button" class="btn btn--ghost btn--sm" id="sg-dismiss">Dismiss</button></div>';
      content.innerHTML = h;

      // "Fix with AI" — send broken YAML + error to Claude for another fix attempt.
      var fixBtn = document.getElementById('sg-fix-ai');
      if (fixBtn && data.yaml && data.yamlError) fixBtn.addEventListener('click', function () {
        fixBtn.disabled = true;
        fixBtn.textContent = 'Fixing...';
        fetch('/agents/' + encodeURIComponent(agentId) + '/analyze/fix-yaml', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ yaml: data.yaml, error: data.yamlError }),
        })
        .then(function (r) { return r.json(); })
        .then(function (result) {
          if (result.ok && result.yaml) {
            data.yaml = result.yaml;
            data.yamlError = result.yamlError || undefined;
            renderResult(data);
          } else {
            fixBtn.disabled = false;
            fixBtn.textContent = 'Fix with AI';
            var err = document.createElement('div');
            err.className = 'flash flash--error';
            err.style.cssText = 'margin-top:var(--space-2);font-size:var(--font-size-xs);';
            err.textContent = 'Fix attempt failed: ' + (result.error || 'Unknown error');
            fixBtn.parentNode.appendChild(err);
          }
        })
        .catch(function () {
          fixBtn.disabled = false;
          fixBtn.textContent = 'Fix with AI';
        });
      });

      // "Apply now" — save the YAML directly without opening the editor.
      var an = document.getElementById('sg-apply-now');
      if (an && data.yaml) an.addEventListener('click', function () {
        var f = document.createElement('form'); f.method = 'POST';
        f.action = '/agents/' + encodeURIComponent(agentId) + '/yaml';
        var t = document.createElement('textarea'); t.name = 'yaml'; t.value = data.yaml; t.style.display = 'none';
        f.appendChild(t); document.body.appendChild(f); f.submit();
      });
      // "Review first" / "Edit manually" — open the YAML editor pre-filled.
      var rv = document.getElementById('sg-review');
      if (rv && data.yaml) rv.addEventListener('click', function () {
        var f = document.createElement('form'); f.method = 'POST';
        f.action = '/agents/' + encodeURIComponent(agentId) + '/yaml';
        var t = document.createElement('textarea'); t.name = 'prefillYaml'; t.value = data.yaml; t.style.display = 'none';
        f.appendChild(t); document.body.appendChild(f); f.submit();
      });
      var db = document.getElementById('sg-dismiss');
      if (db) db.addEventListener('click', closeModal);
    }

    btn.addEventListener('click', function () {
      modal.classList.add('is-open');

      // Step 1: Show a prompt form so the user can optionally describe what to focus on.
      content.innerHTML =
        '<div style="padding:var(--space-4);">' +
          '<h3 style="margin:0 0 var(--space-2);">Suggest improvements for ' + esc(agentId) + '</h3>' +
          '<p class="dim" style="font-size:var(--font-size-xs);margin:0 0 var(--space-3);">Optionally describe what you want the analysis to focus on. Leave blank for a general review.</p>' +
          '<textarea id="sg-focus" rows="3" placeholder="e.g. &quot;Are there missing error handlers?&quot; or &quot;The last run timed out, what can I improve?&quot;" style="width:100%;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border-strong);border-radius:var(--radius-sm);font-size:var(--font-size-sm);font-family:var(--font-mono);resize:vertical;background:var(--color-surface-raised);color:var(--color-text);"></textarea>' +
          '<div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-3);">' +
            '<button type="button" class="btn btn--ghost btn--sm" id="sg-prompt-cancel">Cancel</button>' +
            '<button type="button" class="btn btn--primary btn--sm" id="sg-prompt-go">Analyze</button>' +
          '</div>' +
        '</div>';
      document.getElementById('sg-prompt-cancel').addEventListener('click', closeModal);
      document.getElementById('sg-focus').focus();

      document.getElementById('sg-prompt-go').addEventListener('click', function () {
      var focusText = (document.getElementById('sg-focus').value || '').trim();

      // Step 2: Switch to progress view and start analysis.
      var t0 = Date.now();
      var cancelled = false;
      var pollTimer = null;
      var tickTimer = null;

      function showProgress(phaseMsg) {
        var s = Math.round((Date.now() - t0) / 1000);
        content.innerHTML =
          '<div style="padding:var(--space-4);">' +
          '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">' +
            '<div class="spinner"></div>' +
            '<div style="flex:1;"><div style="font-weight:var(--weight-medium);">Analyzing ' + esc(agentId) + '</div>' +
            '<div class="dim" style="font-size:var(--font-size-xs);" id="sg-phase">' + esc(phaseMsg) + '</div></div>' +
            '<div style="font-family:var(--font-mono);font-size:var(--font-size-lg);color:var(--color-text-muted);min-width:3rem;text-align:right;" id="sg-timer">' + s + 's</div>' +
          '</div>' +
          '<div style="height:4px;background:var(--color-border);border-radius:2px;overflow:hidden;margin-bottom:var(--space-3);">' +
            '<div style="height:100%;background:var(--color-primary);border-radius:2px;width:' + Math.min(s/120*100, 98) + '%;transition:width 1s linear;"></div>' +
          '</div>' +
          '<div style="text-align:right;"><button type="button" class="btn btn--ghost btn--sm" id="sg-cancel">Cancel</button></div>' +
          '</div>';
        var ce = document.getElementById('sg-cancel');
        if (ce) ce.addEventListener('click', function () { cancelled = true; clearInterval(tickTimer); clearTimeout(pollTimer); closeModal(); });
      }

      // Initial progress display.
      showProgress(PHASES[0][1]);

      // Timer tick updates the elapsed time + phase messages.
      tickTimer = setInterval(function () {
        var s = Math.round((Date.now() - t0) / 1000);
        var te = document.getElementById('sg-timer'); if (te) te.textContent = s + 's';
        var be = content.querySelector('[style*="background:var(--color-primary)"]'); if (be) be.style.width = Math.min(s/120*100, 98) + '%';
        var pe = document.getElementById('sg-phase'); if (pe) {
          var m = PHASES[0][1]; for (var i = 0; i < PHASES.length; i++) { if (s >= PHASES[i][0]) m = PHASES[i][1]; }
          pe.textContent = m;
        }
      }, 1000);

      // Start the analysis with optional focus text.
      fetch('/agents/' + encodeURIComponent(agentId) + '/analyze', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: focusText ? 'focus=' + encodeURIComponent(focusText) : '',
      })
      .then(function (r) { return r.json(); })
      .then(function (startData) {
        if (!startData.ok || !startData.runId) {
          clearInterval(tickTimer);
          content.innerHTML =
            '<h3 style="margin:0 0 var(--space-3);">Analysis failed</h3>' +
            '<div class="flash flash--error">' + esc(startData.error || 'Failed to start') + '</div>' +
            '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-modal="1">Close</button></div>';
          return;
        }

        var runId = startData.runId;
        var savedCurrentYaml = startData.currentYaml;

        // Poll for progress + results.
        function poll() {
          if (cancelled) return;
          fetch('/agents/' + encodeURIComponent(agentId) + '/analyze/' + encodeURIComponent(runId), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (cancelled) return;
              if (data.status === 'running') {
                // Update phase from server-provided phase message or progress events.
                var pe = document.getElementById('sg-phase');
                if (pe) {
                  if (data.phase) pe.textContent = data.phase;
                  else if (data.progress && data.progress.length > 0) {
                    var latest = data.progress[data.progress.length - 1];
                    if (latest.message) pe.textContent = latest.message;
                  }
                }
                pollTimer = setTimeout(poll, 2000);
              } else if (data.status === 'done') {
                clearInterval(tickTimer);
                data.currentYaml = data.currentYaml || savedCurrentYaml;
                renderResult(data);
              } else {
                clearInterval(tickTimer);
                content.innerHTML =
                  '<h3 style="margin:0 0 var(--space-3);">Analysis failed</h3>' +
                  '<div class="flash flash--error">' + esc(data.error || 'Unknown error') + '</div>' +
                  '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-modal="1">Close</button></div>';
              }
            })
            .catch(function () { if (!cancelled) pollTimer = setTimeout(poll, 3000); });
        }

        pollTimer = setTimeout(poll, 2000);
      })
      .catch(function (err) {
        clearInterval(tickTimer);
        content.innerHTML =
          '<h3 style="margin:0 0 var(--space-3);">Error</h3>' +
          '<div class="flash flash--error">' + esc(String(err)) + '</div>' +
          '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-modal="1">Close</button></div>';
      });
    }); // end sg-prompt-go click
    }); // end suggest-btn click

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-close-modal')) closeModal();
    });

    // Auto-open from run detail page: ?suggest=1&focus=<error text>
    var params = new URLSearchParams(window.location.search);
    if (params.get('suggest') === '1') {
      btn.click();
      // Pre-fill focus after the modal renders.
      setTimeout(function () {
        var ta = document.getElementById('sg-focus');
        var focusParam = params.get('focus');
        if (ta && focusParam) ta.value = focusParam;
      }, 50);
    }
  })();
`;
