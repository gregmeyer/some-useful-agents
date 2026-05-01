/**
 * Interactive widget shell: wraps the existing output-widget renderer with
 * an inline inputs form + Run button + state machine that polls
 * /runs/:id/widget-status until the run completes.
 *
 * State machine:
 *
 *   idle ──submit──▶ running ──poll──▶ idle (with new result)
 *                       │                │
 *                       │                └──▶ error ──retry──▶ idle
 *                       │
 *                       └──cancel──▶ idle
 *
 * The form is always visible in idle. When a prior run exists, its result
 * is rendered above the form and the submit button uses `replayLabel`.
 * When no prior run exists, the result block is empty and the button uses
 * `askLabel`. After a run completes, the button switches to `replayLabel`.
 *
 * Form inputs are pre-filled with the most recent run's input values
 * (`previousInputs`) when available, falling back to each input's
 * declared default.
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

function renderInputControl(name: string, spec: AgentInputSpec, lastValue?: string): SafeHtml {
  const def = spec.default !== undefined ? String(spec.default) : '';
  const val = lastValue !== undefined ? lastValue : def;
  if (spec.type === 'enum' && Array.isArray(spec.values) && spec.values.length > 0) {
    const opts = spec.values.map((v) => {
      const optVal = String(v);
      const selected = optVal === val ? ' selected' : '';
      return `<option value="${optVal}"${selected}>${optVal}</option>`;
    }).join('');
    return unsafeHtml(`<select name="input_${name}" data-input style="${FIELD}">${opts}</select>`);
  }
  if (spec.type === 'boolean') {
    return unsafeHtml(
      `<select name="input_${name}" data-input style="${FIELD}">` +
      `<option value="true"${val === 'true' ? ' selected' : ''}>true</option>` +
      `<option value="false"${val !== 'true' ? ' selected' : ''}>false</option>` +
      `</select>`,
    );
  }
  if (spec.type === 'number') {
    return html`<input type="number" name="input_${name}" data-input value="${val}" placeholder="${def || '(empty)'}" style="${FIELD}">`;
  }
  return html`<input type="text" name="input_${name}" data-input value="${val}" placeholder="${def || '(empty)'}" style="${FIELD}">`;
}

/**
 * Render the interactive widget shell for an agent. Returns the full tile
 * body — caller wraps with the existing tile container.
 */
export function renderInteractiveWidget(args: {
  agent: Agent;
  widget: OutputWidgetSchema;
  lastRun?: Pick<Run, 'id' | 'result' | 'status' | 'error'>;
  /**
   * Input values from the most recent run (any status). When provided, the
   * form pre-fills with these instead of each input's declared default —
   * so re-running a magic-8-ball-style agent with a tweaked prompt is one
   * edit + one click, not "find the field, retype the whole thing".
   */
  previousInputs?: Record<string, string>;
  /**
   * When true, omit the inline <script> that wires the run state machine.
   * Used by the Output Widget editor's Preview tab so users see the same
   * inputs form + button labels Pulse will render, without the preview
   * accidentally submitting a real run when they click around.
   */
  staticPreview?: boolean;
}): SafeHtml {
  const { agent, widget, lastRun, previousInputs, staticPreview } = args;
  const inputs = pickInputs(agent, widget);
  const askLabel = widget.askLabel ?? 'Run';
  const replayLabel = widget.replayLabel ?? 'Run again';
  const hasResult = !!(lastRun && lastRun.status === 'completed' && typeof lastRun.result === 'string');
  const submitLabel = hasResult ? replayLabel : askLabel;

  const fieldRows = inputs.map(([name, spec]) => html`
    <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-2);">
      <span style="font-size: var(--font-size-xs); display: flex; align-items: baseline; gap: var(--space-2);">
        <strong>${name}</strong>
        ${spec.description ? html`<span class="dim">${spec.description}</span>` : html``}
      </span>
      ${renderInputControl(name, spec, previousInputs?.[name])}
    </label>
  `);

  // Initial idle body — render the widget against the last result.
  const idleBody = hasResult
    ? renderOutputWidget(widget, String(lastRun!.result), agent.id) ?? html`<p class="dim">Widget render failed.</p>`
    : html``;

  return html`
    <div class="iw" data-iw data-iw-agent="${agent.id}" data-iw-state="idle"
         data-iw-ask-label="${askLabel}" data-iw-replay-label="${replayLabel}">
      <style>
        /* Grid stack: every pane sits in the same cell, so the tile's
           height is the tallest pane in the DOM, not the active one. No
           jumpy resize when transitioning between idle, running, and
           error states. */
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
        .iw-result:empty { display: none; }
        .iw-result { margin-bottom: var(--space-3); }
        .iw-cta-row { display: flex; justify-content: flex-end; gap: var(--space-2); padding-top: var(--space-3); }
        .iw-status { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3); }
        .iw-spinner { width: 14px; height: 14px; border: 2px solid var(--color-border); border-top-color: var(--color-primary, #2563eb); border-radius: 50%; animation: iw-spin 700ms linear infinite; }
        @keyframes iw-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .iw-spinner { animation: none; } }
        .iw-error { padding: var(--space-3); border: 1px solid var(--color-err); border-radius: var(--radius-sm); background: rgba(220, 38, 38, 0.04); }
      </style>

      <div class="iw-pane iw-pane-idle">
        <div class="iw-result" data-iw-result>${idleBody}</div>
        <form data-iw-form>
          ${inputs.length > 0 ? fieldRows as unknown as SafeHtml[] : html`<p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-2);">No inputs declared. Click ${submitLabel} to run.</p>`}
          <div class="iw-cta-row">
            <button type="submit" class="btn btn--primary btn--sm" data-iw-submit>${submitLabel}</button>
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

      ${staticPreview ? html`` : unsafeHtml(`<script>
      (function () {
        var root = document.currentScript.parentElement;
        if (!root || !root.matches('[data-iw]')) return;
        var AGENT_ID = ${JSON.stringify(agent.id)};
        var REPLAY_LABEL = ${JSON.stringify(replayLabel)};
        var POLL_MS = 500;
        var POLL_CAP = 120; // 60 s

        var panes = {
          idle: root.querySelector('.iw-pane-idle'),
          running: root.querySelector('.iw-pane-running'),
          stuck: root.querySelector('.iw-pane-stuck'),
          error: root.querySelector('.iw-pane-error'),
        };
        var resultBox = root.querySelector('[data-iw-result]');
        var submitBtn = root.querySelector('[data-iw-submit]');
        var elapsedEl = root.querySelector('[data-iw-elapsed]');
        var errMsgEl = root.querySelector('[data-iw-error-msg]');
        var errLink = root.querySelector('[data-iw-error-link]');
        var stuckLink = root.querySelector('[data-iw-stuck-link]');

        var current = root.getAttribute('data-iw-state') || 'idle';
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
          // Flip the submit button label to replayLabel so first-run tiles
          // stop saying "Ask" once they have a result to show.
          if (submitBtn && submitBtn.textContent !== REPLAY_LABEL) {
            submitBtn.textContent = REPLAY_LABEL;
          }
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
                transition('idle');
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
        var retry = root.querySelector('[data-iw-retry]');
        if (retry) retry.addEventListener('click', function () { transition('idle'); });
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
      ${staticPreview ? html`<p class="dim" style="font-size: var(--font-size-xs); margin: var(--space-3) 0 0; padding: var(--space-2) var(--space-3); background: var(--color-surface); border-radius: var(--radius-sm); border-left: 3px solid var(--color-info);">Preview only — clicking the form here doesn't run the agent. Save and visit the Pulse tile to interact for real.</p>` : html``}
    </div>
  `;
}
