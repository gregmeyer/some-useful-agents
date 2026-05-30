import { html, unsafeHtml, type SafeHtml } from '../html.js';
import {
  renderVariablesEditor,
  renderNotifyEditor,
  providerOption,
  renderModelOptions,
} from '../agent-detail-helpers.js';
import { cronToHuman } from '../components.js';
import { agentPageShell, type AgentDetailArgs } from './shell.js';

/**
 * One Config-tab section as a `.card` with a standardised header.
 * Folds the repeated `style="margin: 0 0 var(--space-3);"` heading
 * pattern into one place.
 */
function configCard(title: string, body: SafeHtml): SafeHtml {
  return html`
    <section class="card">
      <h3 style="margin: 0 0 var(--space-3);">${title}</h3>
      ${body}
    </section>
  `;
}

/**
 * Wrap a heavyweight editor (Output Widget, Notify) in a collapsed
 * `<details>` when the agent already has the feature configured. When
 * not configured, render a small "Set up" CTA that opens the editor.
 * This keeps the Config tab roughly one viewport tall by default.
 */
function collapsibleSection(args: {
  title: string;
  configured: boolean;
  emptyCta: SafeHtml;
  editor: SafeHtml;
}): SafeHtml {
  if (!args.configured) {
    return html`
      <section class="card">
        <h3 style="margin: 0 0 var(--space-3);">${args.title}</h3>
        ${args.emptyCta}
      </section>
    `;
  }
  return html`
    <details class="card config-collapsible">
      <summary>
        <h3 style="margin: 0; display: inline;">${args.title}</h3>
        <span class="dim" style="margin-left: var(--space-2); font-size: var(--font-size-xs);">configured — click to edit</span>
      </summary>
      <div style="padding: var(--space-3) 0 0;">
        ${args.editor}
      </div>
    </details>
  `;
}

export async function renderAgentConfig(args: AgentDetailArgs): Promise<string> {
  const { agent, secretsStore } = args;

  // Secret counts for the Secrets summary line
  let secretsSet = 0;
  let secretsMissing = 0;
  const allSecrets = new Set<string>();
  for (const node of agent.nodes) {
    for (const name of node.secrets ?? []) allSecrets.add(name);
  }
  for (const name of allSecrets) {
    try { if (await secretsStore.has(name)) secretsSet++; else secretsMissing++; } catch { /* unknown */ }
  }

  // ── Left column: lightweight controls ──────────────────────────────

  // Visibility: two independent toggles. Both default to true (visible).
  // `pulseVisible` = master switch for the Pulse tile. Hides the tile
  // even if a signal is declared. `dashboardVisible` = hide from /agents
  // list (still reachable by direct URL, MCP, scheduler, runs page).
  const pulseOn = agent.pulseVisible !== false;
  const dashOn = agent.dashboardVisible !== false;
  const visibilityCard = configCard('Visibility', html`
    <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
      Where this agent shows up in the dashboard.
    </p>
    <div style="display: flex; flex-direction: column; gap: var(--space-2);">
      <form method="POST" action="/agents/${agent.id}/visibility" style="display: flex; gap: var(--space-2); align-items: center;">
        <input type="hidden" name="field" value="pulse">
        <input type="hidden" name="enabled" value="${pulseOn ? 'false' : 'true'}">
        <span style="flex: 1; font-size: var(--font-size-sm);">Show on Pulse</span>
        ${pulseOn
          ? html`<span class="badge badge--ok">on</span><button type="submit" class="btn btn--sm">Hide</button>`
          : html`<span class="badge badge--muted">off</span><button type="submit" class="btn btn--sm">Show</button>`}
      </form>
      <form method="POST" action="/agents/${agent.id}/visibility" style="display: flex; gap: var(--space-2); align-items: center;">
        <input type="hidden" name="field" value="dashboard">
        <input type="hidden" name="enabled" value="${dashOn ? 'false' : 'true'}">
        <span style="flex: 1; font-size: var(--font-size-sm);">Show in /agents list</span>
        ${dashOn
          ? html`<span class="badge badge--ok">on</span><button type="submit" class="btn btn--sm">Hide</button>`
          : html`<span class="badge badge--muted">off</span><button type="submit" class="btn btn--sm">Show</button>`}
      </form>
    </div>
    ${agent.pulseVisible === false || agent.dashboardVisible === false
      ? html`<p class="dim" style="font-size: var(--font-size-xs); margin: var(--space-2) 0 0;">Hidden agents are still reachable by direct URL, MCP, scheduler, and the runs page.</p>`
      : html``}
  `);

  const scheduleCard = (() => {
    // The scheduler watches the `schedule` column on the agents row;
    // editing it here is metadata-only (no version bump). Empty input
    // disables the schedule. Validation lives server-side — we don't
    // try to gate keystrokes here because the cron-validator messages
    // are more useful than what we'd hand-roll in JS.
    const current = agent.schedule ?? '';
    const human = current ? cronToHuman(current) : null;
    return configCard('Schedule', html`
      <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-2);">
        Pick a preset or type a five-field cron expression. Empty disables.
      </p>
      <div class="schedule-presets" style="display: flex; flex-wrap: wrap; gap: var(--space-1); margin-bottom: var(--space-2);">
        <button type="button" class="btn btn--ghost btn--sm schedule-preset" data-cron="*/5 * * * *">Every 5m</button>
        <button type="button" class="btn btn--ghost btn--sm schedule-preset" data-cron="*/15 * * * *">Every 15m</button>
        <button type="button" class="btn btn--ghost btn--sm schedule-preset" data-cron="0 * * * *">Hourly</button>
        <button type="button" class="btn btn--ghost btn--sm schedule-preset" data-cron="0 8 * * *">Daily 8am</button>
        <button type="button" class="btn btn--ghost btn--sm schedule-preset" data-cron="0 9 * * 1-5">Weekdays 9am</button>
        <button type="button" class="btn btn--ghost btn--sm schedule-preset" data-cron="0 9 * * 1">Mon 9am</button>
        <button type="button" class="btn btn--ghost btn--sm schedule-preset" data-cron="">Disable</button>
      </div>
      <form method="POST" action="/agents/${agent.id}/schedule" style="display: flex; flex-direction: column; gap: var(--space-2);" data-schedule-form>
        <div style="display: flex; gap: var(--space-2); align-items: center;">
          <input type="text" name="schedule" value="${current}" placeholder="0 8 * * *"
                 class="form-field mono schedule-input"
                 style="flex: 1; padding: var(--space-1) var(--space-2); font-size: var(--font-size-sm);" />
          <button type="submit" class="btn btn--sm">Save</button>
        </div>
        ${current
          ? html`<div class="dim" style="font-size: var(--font-size-xs);">${human ? html`Currently: <strong>${human}</strong>` : html`<span style="color: var(--color-danger);">Currently set, but not parseable as cron.</span>`}</div>`
          : html`<div class="dim" style="font-size: var(--font-size-xs);">No schedule. The agent only fires on demand (run-now / MCP).</div>`}
        ${current && agent.allowHighFrequency
          ? html`<div class="dim" style="font-size: var(--font-size-xs); color: var(--color-warn);">allowHighFrequency: true — sub-minute schedules permitted.</div>`
          : html``}
      </form>
      ${unsafeHtml(`<script>
        (function () {
          var form = document.querySelector('[data-schedule-form]');
          if (!form) return;
          var input = form.querySelector('.schedule-input');
          var chips = document.querySelectorAll('.schedule-preset');
          function sync() {
            for (var i = 0; i < chips.length; i++) {
              chips[i].classList.toggle('is-active', chips[i].getAttribute('data-cron') === input.value.trim());
            }
          }
          for (var i = 0; i < chips.length; i++) {
            chips[i].addEventListener('click', function () {
              input.value = this.getAttribute('data-cron') || '';
              sync();
              input.focus();
            });
          }
          input.addEventListener('input', sync);
          sync();
        })();
      </script>`)}
    `);
  })();

  const mcpCard = configCard('MCP exposure', html`
    <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
      Lets MCP clients (Claude Desktop, Claude Code, Cursor) call this agent via <a href="/settings/mcp">sua's MCP server</a>.
    </p>
    <form method="POST" action="/agents/${agent.id}/mcp" style="display: flex; gap: var(--space-2); align-items: center;">
      <input type="hidden" name="enabled" value="${agent.mcp ? 'false' : 'true'}">
      ${agent.mcp
        ? html`<span class="badge badge--ok">exposed</span><button type="submit" class="btn btn--sm btn--warn">Stop exposing</button>`
        : html`<span class="badge badge--muted">not exposed</span><button type="submit" class="btn btn--sm">Expose via MCP</button>`}
    </form>
  `);

  const permImgSrc = agent.permissions?.imgSrc ?? [];

  // Recently-blocked img-src pills. The CSP-violation listener
  // (csp-img-report.js.ts) reports blocks server-side; this surfaces them
  // as one-click "Allow" buttons that POST to /permissions/allow-host and
  // also clear the underlying suggestion so the pill doesn't linger. The
  // backing `data-blocked-host-list` div is re-rendered after each allow
  // by csp-img-report-pills.js.ts so the panel updates without a full
  // page reload.
  const blockedHostsBlock = (() => {
    const blocked = (args.blockedImgHosts ?? []).filter((b) => !permImgSrc.includes(b.host));
    if (blocked.length === 0) {
      return html`
        <div data-blocked-host-list="${agent.id}" hidden></div>
      `;
    }
    const pills = blocked.map((b) => html`
      <form method="POST" action="/agents/${agent.id}/permissions/allow-host" data-blocked-host-form
        style="display: inline-flex; margin: 0;">
        <input type="hidden" name="host" value="${b.host}">
        <input type="hidden" name="redirect" value="/agents/${agent.id}/config">
        <button type="submit" class="btn btn--sm btn--ghost" title="Allow ${b.host} for this agent"
          style="font-family: var(--font-mono); font-size: var(--font-size-xs);">
          + ${b.host}${b.count > 1 ? html` <span class="dim">(${String(b.count)})</span>` : html``}
        </button>
      </form>
    `);
    return html`
      <div data-blocked-host-list="${agent.id}"
        style="margin-bottom: var(--space-3); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface-raised);">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2);">
          <strong style="font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted);">
            Recently blocked
          </strong>
          <form method="POST" action="/api/img-blocks/${agent.id}/dismiss" data-blocked-host-dismiss style="margin: 0;">
            <input type="hidden" name="redirect" value="/agents/${agent.id}/config">
            <button type="submit" class="btn btn--xs btn--ghost" title="Dismiss all">Dismiss all</button>
          </form>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: var(--space-1);">
          ${pills as unknown as SafeHtml[]}
        </div>
        <p class="dim" style="font-size: var(--font-size-xs); margin: var(--space-2) 0 0;">
          Click a host to add it to this agent's <code>img-src</code> allowlist.
        </p>
      </div>
    `;
  })();

  const permissionsCard = configCard('Permissions', html`
    <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
      Hosts this agent's widgets can load images from. Each line widens the
      page CSP <code>img-src</code> directive (prefixed with <code>https://</code>).
      Wildcards like <code>*.unsplash.com</code> are allowed. Saving creates a
      new agent version.
    </p>
    ${blockedHostsBlock}
    <form method="POST" action="/agents/${agent.id}/permissions" style="display: flex; flex-direction: column; gap: var(--space-2);">
      <label style="font-size: var(--font-size-xs); color: var(--color-text-muted);">img-src hosts (one per line)</label>
      <textarea name="imgSrc" rows="3" placeholder="images.unsplash.com&#10;*.unsplash.com"
        class="form-field mono"
        style="padding: var(--space-1) var(--space-2); font-size: var(--font-size-sm); resize: vertical;">${permImgSrc.join('\n')}</textarea>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span class="dim" style="font-size: var(--font-size-xs);">
          ${permImgSrc.length === 0
            ? html`No hosts declared.`
            : html`${String(permImgSrc.length)} host${permImgSrc.length === 1 ? '' : 's'} declared.`}
        </span>
        <button type="submit" class="btn btn--sm">Save</button>
      </div>
    </form>
  `);

  const llmCard = configCard('LLM defaults', html`
    <form method="POST" action="/agents/${agent.id}/llm" id="llm-form" style="display: flex; flex-direction: column; gap: var(--space-2);">
      <div style="display: flex; gap: var(--space-2); align-items: center;">
        <label style="font-size: var(--font-size-xs); color: var(--color-text-muted); min-width: 55px;">Provider</label>
        <select name="provider" id="llm-provider" class="form-field" style="flex: 1; padding: var(--space-1) var(--space-2); font-size: var(--font-size-sm);">
          ${providerOption('claude', agent.provider)}
          ${providerOption('codex', agent.provider)}
          ${providerOption('apple-foundation-models', agent.provider)}
        </select>
      </div>
      <div style="display: flex; gap: var(--space-2); align-items: center;">
        <label style="font-size: var(--font-size-xs); color: var(--color-text-muted); min-width: 55px;">Model</label>
        <select name="model" id="llm-model" class="form-field" style="flex: 1; padding: var(--space-1) var(--space-2); font-size: var(--font-size-sm); font-family: var(--font-mono);">
          ${renderModelOptions(agent.provider, agent.model)}
        </select>
      </div>
      <div id="llm-model-desc" class="dim" style="font-size: var(--font-size-xs); min-height: 1.2em;"></div>
      <div style="display: flex; justify-content: flex-end;">
        <button type="submit" class="btn btn--sm">Save</button>
      </div>
      <p class="dim" style="font-size: var(--font-size-xs); margin: 0;">Applies to all llm-prompt nodes. Individual nodes can override in YAML.</p>
    </form>
  `);

  const variablesCard = configCard('Variables', renderVariablesEditor(agent));

  const secretsCard = configCard('Secrets', html`
    <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-2);">
      ${String(allSecrets.size)} declared. ${String(secretsSet)} set, ${String(secretsMissing)} missing.
    </p>
    <a href="/settings/secrets" class="btn btn--sm">Manage secrets</a>
  `);

  // ── Right column: heavyweight collapsibles ─────────────────────────
  // Output Widget editor lives on its own page — `/agents/<id>/output-widget`
  // — because the editor is large enough to deserve a focused surface
  // with sub-tabs (Type / Fields / Interactive / Preview). On the Config
  // tab we just summarise + link.
  const outputWidgetSection = (() => {
    if (!agent.outputWidget) {
      return configCard('Output Widget', html`
        <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
          Render run output as a widget on the agent overview and the Pulse tile.
        </p>
        <a class="btn btn--sm" href="/agents/${agent.id}/output-widget">Set up output widget</a>
      `);
    }
    const fieldCount = agent.outputWidget.fields?.length ?? 0;
    const summary = agent.outputWidget.type === 'ai-template'
      ? 'AI-generated HTML template'
      : `${String(fieldCount)} field${fieldCount === 1 ? '' : 's'}`;
    return configCard('Output Widget', html`
      <dl class="kv" style="margin: 0 0 var(--space-3); font-size: var(--font-size-xs);">
        <dt>Type</dt><dd class="mono">${agent.outputWidget.type}</dd>
        <dt>Layout</dt><dd>${summary}</dd>
        ${agent.outputWidget.interactive ? html`<dt>Interactive</dt><dd>yes — runs in place</dd>` : html``}
      </dl>
      <a class="btn btn--sm" href="/agents/${agent.id}/output-widget">Edit output widget</a>
    `);
  })();

  const notifySection = collapsibleSection({
    title: 'Notify',
    configured: !!agent.notify,
    emptyCta: html`
      <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
        Send a Slack message or webhook when a run finishes.
      </p>
      <details class="config-empty-cta">
        <summary><span class="btn btn--sm">Set up notify</span></summary>
        <div style="margin-top: var(--space-3);">
          ${renderNotifyEditor(agent, { integrations: args.availableIntegrations })}
        </div>
      </details>
    `,
    editor: renderNotifyEditor(agent, { integrations: args.availableIntegrations }),
  });

  // Variables runs full-width because its editor is a 5-column table that
  // doesn't compress gracefully into half a viewport. Keeping it above the
  // two-column grid puts the most-frequently-edited control where the eye
  // lands first and avoids horizontal overflow into the right column.
  const content = html`
    ${variablesCard}
    <div class="config-grid" style="margin-top: var(--space-4);">
      <div class="config-grid__col">
        ${llmCard}
        ${scheduleCard}
        ${visibilityCard}
        ${mcpCard}
        ${permissionsCard}
        ${secretsCard}
      </div>
      <div class="config-grid__col">
        ${outputWidgetSection}
        ${notifySection}
      </div>
    </div>
  `;

  return agentPageShell({ ...args, activeTab: 'config' }, content);
}
