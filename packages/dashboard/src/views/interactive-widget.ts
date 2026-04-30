/**
 * Interactive widget shell: wraps the existing output-widget renderer with
 * an inline inputs form + Run button + state machine that polls
 * /runs/:id/widget-status until the run completes.
 *
 * State machine (see ~/.claude/plans/interactive-widgets.md):
 *
 *   idle ──askAgain──▶ asking ──submit──▶ running ──poll──▶ success | error
 *    ▲                  │                      │                │      │
 *    │ replay            │ cancel(empty)        │ cancel         │      │
 *    └───────────────────┴──────────────────────┴────────────────┴──────┘
 *
 * Hydration: when `lastRun` is set, the shell starts in `idle` rendering
 * the widget against the last result. When there's no prior run, it
 * starts in `asking` so the user lands on the form.
 */

import type { Agent, AgentInputSpec, OutputWidgetSchema, Run } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';
import { renderOutputWidget } from './output-widgets.js';

const FIELD = 'padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); width: 100%; box-sizing: border-box;';

/**
 * Returns the inputs the interactive tile should expose, in declaration
 * order. If the widget declares `runInputs`, that subset (preserving
 * order) is used; otherwise every input is shown.
 */
function pickInputs(
  agent: Agent,
  widget: OutputWidgetSchema,
): Array<[string, AgentInputSpec]> {
  const all = Object.entries(agent.inputs ?? {});
  if (!widget.runInputs || widget.runInputs.length === 0) return all;
  const allow = new Set(widget.runInputs);
  return all.filter(([name]) => allow.has(name));
}

function renderInputControl(name: string, spec: AgentInputSpec): SafeHtml {
  const def = spec.default !== undefined ? String(spec.default) : '';
  if (spec.type === 'enum' && Array.isArray(spec.values) && spec.values.length > 0) {
    const opts = spec.values.map((v) => {
      const val = String(v);
      const selected = val === def ? ' selected' : '';
      return `<option value="${val}"${selected}>${val}</option>`;
    }).join('');
    return unsafeHtml(`<select name="input_${name}" data-input style="${FIELD}">${opts}</select>`);
  }
  if (spec.type === 'boolean') {
    return unsafeHtml(
      `<select name="input_${name}" data-input style="${FIELD}">` +
      `<option value="true"${def === 'true' ? ' selected' : ''}>true</option>` +
      `<option value="false"${def !== 'true' ? ' selected' : ''}>false</option>` +
      `</select>`,
    );
  }
  if (spec.type === 'number') {
    return html`<input type="number" name="input_${name}" data-input value="${def}" placeholder="${def || '(empty)'}" style="${FIELD}">`;
  }
  return html`<input type="text" name="input_${name}" data-input value="${def}" placeholder="${def || '(empty)'}" style="${FIELD}">`;
}

/**
 * Render the interactive widget shell for an agent. Returns the full tile
 * body — caller wraps with the existing tile container.
 */
export function renderInteractiveWidget(args: {
  agent: Agent;
  widget: OutputWidgetSchema;
  lastRun?: Pick<Run, 'id' | 'result' | 'status' | 'error'>;
}): SafeHtml {
  const { agent, widget, lastRun } = args;
  const inputs = pickInputs(agent, widget);
  const askLabel = widget.askLabel ?? 'Run';
  const replayLabel = widget.replayLabel ?? 'Run again';
  const hasResult = lastRun && lastRun.status === 'completed' && typeof lastRun.result === 'string';
  const startState: 'idle' | 'asking' = hasResult ? 'idle' : 'asking';

  const fieldRows = inputs.map(([name, spec]) => html`
    <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-2);">
      <span style="font-size: var(--font-size-xs); display: flex; align-items: baseline; gap: var(--space-2);">
        <strong>${name}</strong>
        ${spec.description ? html`<span class="dim">${spec.description}</span>` : html``}
      </span>
      ${renderInputControl(name, spec)}
    </label>
  `);

  // Initial idle body — render the widget against the last result.
  const idleBody = hasResult
    ? renderOutputWidget(widget, String(lastRun.result), agent.id) ?? html`<p class="dim">Widget render failed.</p>`
    : html``;

  return html`
    <div class="iw" data-iw data-iw-agent="${agent.id}" data-iw-state="${startState}">
      <style>
        /* Grid stack: every pane sits in the same cell, so the tile's
           height is the tallest pane in the DOM, not the active one. No
           jumpy resize when transitioning between asking, running, and
           result states. */
        .iw {
          display: grid;
          grid-template-areas: 'stack';
          position: relative;
          min-height: 8rem;
        }
        .iw-pane {
          grid-area: stack;
          display: flex;
          flex-direction: column;
          transition: opacity 220ms ease, transform 220ms ease;
        }
        /* Hidden panes still contribute to grid sizing — that's the point.
           Use opacity + visibility instead of display:none so the cell
           stays at max(child heights). pointer-events disabled so clicks
           pass through to whatever is on top. */
        .iw-pane.iw-pane-inactive {
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
        }
        .iw-pane.iw-leaving { opacity: 0; transform: translateY(-4px); }
        .iw-pane.iw-entering { opacity: 0; transform: translateY(4px); }
        .iw-pane.iw-entered { opacity: 1; transform: translateY(0); }
        /* Short panes (spinner-only, error card) center vertically in the
           cell so they don't anchor to the top of an over-sized container. */
        .iw-pane-running, .iw-pane-stuck, .iw-pane-error { justify-content: center; }
        .iw[data-iw-state="running"] { box-shadow: 0 0 0 1px var(--color-primary, #2563eb); animation: iw-pulse 1.6s ease-in-out infinite; border-radius: var(--radius-md); }
        @keyframes iw-pulse {
          0%, 100% { box-shadow: 0 0 0 1px var(--color-primary, #2563eb); }
          50%      { box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18); }
        }
        @media (prefers-reduced-motion: reduce) {
          .iw-pane { transition: none; }
          .iw[data-iw-state="running"] { animation: none; }
        }
        /* Push CTA rows to the bottom so the form's button stays anchored
           regardless of how tall the cell is. */
        .iw-cta-row { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: auto; padding-top: var(--space-3); }
        .iw-status { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3); }
        .iw-spinner { width: 14px; height: 14px; border: 2px solid var(--color-border); border-top-color: var(--color-primary, #2563eb); border-radius: 50%; animation: iw-spin 700ms linear infinite; }
        @keyframes iw-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .iw-spinner { animation: none; } }
        .iw-error { padding: var(--space-3); border: 1px solid var(--color-err); border-radius: var(--radius-sm); background: rgba(220, 38, 38, 0.04); }
      </style>

      <div class="iw-pane iw-pane-idle ${startState === 'idle' ? '' : 'iw-pane-inactive'}">
        <div class="iw-result">${idleBody}</div>
        <div class="iw-cta-row">
          <button type="button" class="btn btn--primary btn--sm" data-iw-replay>${replayLabel}</button>
        </div>
      </div>

      <div class="iw-pane iw-pane-asking ${startState === 'asking' ? '' : 'iw-pane-inactive'}">
        <form data-iw-form>
          ${inputs.length > 0 ? fieldRows as unknown as SafeHtml[] : html`<p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-2);">No inputs declared. Click ${askLabel} to run.</p>`}
          <div class="iw-cta-row">
            ${hasResult ? html`<button type="button" class="btn btn--ghost btn--sm" data-iw-cancel-asking>Cancel</button>` : html``}
            <button type="submit" class="btn btn--primary btn--sm">${askLabel}</button>
          </div>
        </form>
      </div>

      <div class="iw-pane iw-pane-running iw-pane-inactive">
        <div class="iw-status">
          <div class="iw-spinner" aria-hidden="true"></div>
          <span>Running… <span data-iw-elapsed>0</span>s</span>
          <button type="button" class="btn btn--ghost btn--sm" data-iw-cancel-run style="margin-left: auto;">Cancel</button>
        </div>
      </div>

      <div class="iw-pane iw-pane-stuck iw-pane-inactive">
        <div class="iw-status">
          <span>Still running. <a data-iw-stuck-link href="#">View run details</a></span>
        </div>
      </div>

      <div class="iw-pane iw-pane-error iw-pane-inactive">
        <div class="iw-error">
          <p style="margin: 0 0 var(--space-2); font-weight: var(--weight-bold); color: var(--color-err);">Run failed</p>
          <p data-iw-error-msg style="margin: 0 0 var(--space-2); font-size: var(--font-size-xs); font-family: var(--font-mono); white-space: pre-wrap;"></p>
          <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
            <a data-iw-error-link class="btn btn--ghost btn--sm" href="#">View run</a>
            <button type="button" class="btn btn--primary btn--sm" data-iw-retry>Retry</button>
          </div>
        </div>
      </div>

      ${unsafeHtml(`<script>
      (function () {
        var root = document.currentScript.parentElement;
        if (!root || !root.matches('[data-iw]')) return;
        var AGENT_ID = ${JSON.stringify(agent.id)};
        var POLL_MS = 500;
        var POLL_CAP = 120; // 60 s

        var panes = {
          idle: root.querySelector('.iw-pane-idle'),
          asking: root.querySelector('.iw-pane-asking'),
          running: root.querySelector('.iw-pane-running'),
          stuck: root.querySelector('.iw-pane-stuck'),
          error: root.querySelector('.iw-pane-error'),
        };
        var resultBox = root.querySelector('.iw-result');
        var elapsedEl = root.querySelector('[data-iw-elapsed]');
        var errMsgEl = root.querySelector('[data-iw-error-msg]');
        var errLink = root.querySelector('[data-iw-error-link]');
        var stuckLink = root.querySelector('[data-iw-stuck-link]');

        var current = root.getAttribute('data-iw-state') || 'asking';
        var pollTimer = null;
        var elapsedTimer = null;
        var startMs = 0;
        var pollCount = 0;
        var currentRunId = null;

        function transition(next) {
          if (current === next) return;
          var leaving = panes[current];
          var entering = panes[next];
          root.setAttribute('data-iw-state', next);
          if (leaving) {
            leaving.classList.add('iw-leaving');
            setTimeout(function () {
              leaving.classList.add('iw-pane-inactive');
              leaving.classList.remove('iw-leaving');
            }, 220);
          }
          if (entering) {
            entering.classList.remove('iw-pane-inactive');
            entering.classList.add('iw-entering');
            requestAnimationFrame(function () {
              entering.classList.remove('iw-entering');
              entering.classList.add('iw-entered');
              setTimeout(function () { entering.classList.remove('iw-entered'); }, 240);
            });
          }
          current = next;
        }

        function clearPoll() {
          if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
          if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
        }

        function startElapsed() {
          startMs = Date.now();
          if (elapsedEl) elapsedEl.textContent = '0';
          elapsedTimer = setInterval(function () {
            if (!elapsedEl) return;
            elapsedEl.textContent = String(Math.floor((Date.now() - startMs) / 1000));
          }, 250);
        }

        function showError(msg, runId) {
          if (errMsgEl) errMsgEl.textContent = msg || 'Unknown error.';
          if (errLink && runId) errLink.setAttribute('href', '/runs/' + encodeURIComponent(runId));
          transition('error');
        }

        function showSuccess(html) {
          if (resultBox) resultBox.innerHTML = html;
          transition('idle');
        }

        function poll() {
          if (!currentRunId) return;
          if (pollCount >= POLL_CAP) {
            clearPoll();
            if (stuckLink) stuckLink.setAttribute('href', '/runs/' + encodeURIComponent(currentRunId));
            transition('stuck');
            return;
          }
          pollCount += 1;
          fetch('/runs/' + encodeURIComponent(currentRunId) + '/widget-status', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
            .then(function (data) {
              if (data.status === 'completed') {
                clearPoll();
                // Server-side rendered widget HTML when the agent has an
                // outputWidget — keeps the rendering identical to the static
                // pulse tile path. Falls back to a JSON-pretty <pre> only
                // when no widget can be rendered (no outputWidget, or the
                // schema rejected the result).
                var html = '';
                if (typeof data.widgetHtml === 'string' && data.widgetHtml.length > 0) {
                  html = data.widgetHtml;
                } else {
                  var resultText = (data.result == null ? '' : String(data.result));
                  html = '<pre style="margin: 0; white-space: pre-wrap; font-family: var(--font-mono); font-size: var(--font-size-xs);">' +
                    resultText.replace(/[<>&]/g, function (c) { return c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'; }) +
                    '</pre>';
                }
                if (resultBox) resultBox.innerHTML = html;
                showSuccess(html);
                return;
              }
              if (data.status === 'failed') {
                clearPoll();
                showError(data.error || 'Run failed.', data.runId);
                return;
              }
              if (data.status === 'cancelled') {
                clearPoll();
                // After a cancel, return to whichever pane was visible
                // before submit. The "idle" pane has rendered content
                // when the agent had a prior run; use that as the cue.
                var hadPrior = panes.idle && panes.idle.querySelector('.iw-result *');
                transition(hadPrior ? 'idle' : 'asking');
                return;
              }
              // running / pending: keep polling
              pollTimer = setTimeout(poll, POLL_MS);
            })
            .catch(function (err) {
              clearPoll();
              showError('Status poll failed: ' + (err.message || err), currentRunId);
            });
        }

        function submitForm(form) {
          var fd = new FormData(form);
          var body = new URLSearchParams();
          fd.forEach(function (v, k) { body.append(k, String(v)); });
          transition('running');
          startElapsed();
          pollCount = 0;
          fetch('/agents/' + encodeURIComponent(AGENT_ID) + '/widget-run', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
          })
            .then(function (r) {
              if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || ('HTTP ' + r.status)); });
              return r.json();
            })
            .then(function (data) {
              currentRunId = data.runId;
              pollTimer = setTimeout(poll, POLL_MS);
            })
            .catch(function (err) {
              clearPoll();
              showError('Failed to start run: ' + (err.message || err));
            });
        }

        // Wire events.
        var form = root.querySelector('[data-iw-form]');
        if (form) {
          form.addEventListener('submit', function (ev) {
            ev.preventDefault();
            submitForm(form);
          });
        }
        var replay = root.querySelector('[data-iw-replay]');
        if (replay) replay.addEventListener('click', function () { transition('asking'); });
        var cancelAsking = root.querySelector('[data-iw-cancel-asking]');
        if (cancelAsking) cancelAsking.addEventListener('click', function () { transition('idle'); });
        var retry = root.querySelector('[data-iw-retry]');
        if (retry) retry.addEventListener('click', function () { transition('asking'); });
        var cancelRun = root.querySelector('[data-iw-cancel-run]');
        if (cancelRun) cancelRun.addEventListener('click', function () {
          if (!currentRunId) return;
          fetch('/runs/' + encodeURIComponent(currentRunId) + '/cancel', {
            method: 'POST', credentials: 'same-origin',
          }).catch(function () { /* ignore */ });
          // Poll loop will pick up the cancelled status on the next tick.
        });
      })();
      </script>`)}
    </div>
  `;
}
