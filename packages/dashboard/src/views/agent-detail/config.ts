import { html, unsafeHtml, type SafeHtml } from '../html.js';
import {
  renderVariablesEditor,
  renderNotifyEditor,
  MODEL_SUGGESTIONS,
} from '../agent-detail-helpers.js';
import { agentPageShell, type AgentDetailArgs } from './shell.js';
import { formatAge } from '../components.js';
import { LLM_PROVIDERS, PROVIDERS, type Agent, type Webhook } from '@some-useful-agents/core';
import { SETTINGS_SECTIONS, whenLabel, runOnLabel } from '../../lib/agent-settings.js';

/** Schedule presets on the "When it runs" chips. `''` = only when asked. */
const SCHEDULE_PRESETS: ReadonlyArray<{ cron: string; label: string }> = [
  { cron: '', label: 'Only when asked' },
  { cron: '0 * * * *', label: 'Hourly' },
  { cron: '0 8 * * *', label: 'Daily 8am' },
  { cron: '0 9 * * 1-5', label: 'Weekdays 9am' },
  { cron: '0 9 * * 1', label: 'Mondays 9am' },
];

/** The batched form's fields; the server applies only these. */
const BATCHED_FIELDS = 'provider,model,schedule,runOn,pulseVisible,dashboardVisible,mcp,inboxRunnable,imgSrc';

/** One Settings section: title + a plain one-line summary, then its controls. */
function settingsSection(id: string, title: string, summary: SafeHtml | string, body: SafeHtml, opts: { ownSave?: boolean } = {}): SafeHtml {
  return html`
    <section class="settings-section" id="settings-${id}" data-settings-section="${id}" aria-labelledby="settings-${id}-title">
      <header class="settings-section__head">
        <h2 class="settings-section__title" id="settings-${id}-title">${title}</h2>
        <p class="settings-section__summary">${summary}</p>
        ${opts.ownSave ? html`<p class="settings-section__own">Each part here saves on its own.</p>` : html``}
      </header>
      ${body}
    </section>
  `;
}

/** A switch-styled checkbox that belongs to the batched form. */
function settingsSwitch(name: string, label: string, hint: string, on: boolean, versioned = false): SafeHtml {
  return html`
    <label class="settings-switch">
      <input type="checkbox" role="switch" name="${name}" value="1" form="agent-settings"${on ? unsafeHtml(' checked') : unsafeHtml('')}${versioned ? unsafeHtml(' data-versioned') : unsafeHtml('')}>
      <span class="settings-switch__track" aria-hidden="true"></span>
      <span class="settings-switch__text">
        <span>${label}</span>
        ${hint ? html`<span class="settings-switch__hint">${hint}</span>` : html``}
      </span>
    </label>
  `;
}

export async function renderAgentConfig(args: AgentDetailArgs): Promise<string> {
  const { agent, secretsStore } = args;
  const id = agent.id;

  // Secret counts for the Access summary
  let secretsSet = 0;
  let secretsMissing = 0;
  const allSecrets = new Set<string>();
  for (const node of agent.nodes) {
    for (const name of node.secrets ?? []) allSecrets.add(name);
  }
  for (const name of allSecrets) {
    try { if (await secretsStore.has(name)) secretsSet++; else secretsMissing++; } catch { /* unknown */ }
  }

  // ── Inputs (own editor, saves on its own) ──────────────────────────
  const inputs = Object.entries(agent.inputs ?? {});
  const inputsSection = settingsSection('inputs', 'Inputs',
    inputs.length === 0 ? 'None. It runs the same way every time.' : `${String(inputs.length)} input${inputs.length === 1 ? '' : 's'} · what you can pass when it runs`,
    html`
      ${inputs.length > 0 ? html`<ul class="settings-inputs">
        ${inputs.map(([name, spec]) => html`<li class="settings-inputs__row">
          <span class="settings-inputs__name">${name}</span>
          <span class="settings-inputs__type">${spec.type}</span>
          <span class="settings-inputs__desc">${spec.description ?? ''}${spec.default !== undefined ? html` <span class="settings-inputs__def">· default ${String(spec.default)}</span>` : html``}</span>
        </li>`) as unknown as SafeHtml[]}
      </ul>` : html``}
      <details class="settings-more" id="variables"${args.flash && /input|default|enum/i.test(args.flash.message) ? unsafeHtml(' open') : unsafeHtml('')}>
        <summary>${inputs.length > 0 ? 'Edit inputs' : 'Add an input'} <span class="settings-more__note">saves on its own</span></summary>
        <div class="settings-more__body">${renderVariablesEditor(agent)}</div>
      </details>
    `);

  // ── Model ──────────────────────────────────────────────────────────
  const providerOpts = [
    html`<option value=""${!agent.provider ? unsafeHtml(' selected') : unsafeHtml('')}>Default (sua's default)</option>`,
    ...LLM_PROVIDERS.map((p) => html`<option value="${p}"${agent.provider === p ? unsafeHtml(' selected') : unsafeHtml('')}>${PROVIDERS[p].displayName}</option>`),
  ];
  const modelSection = settingsSection('model', 'Model', 'Which model answers, for every prompt in this agent', html`
    <div class="settings-fields">
      <label class="settings-field">
        <span class="settings-field__label">Provider</span>
        <select name="provider" form="agent-settings" class="form-field" data-versioned data-settings-provider>${providerOpts as unknown as SafeHtml[]}</select>
      </label>
      <label class="settings-field">
        <span class="settings-field__label">Model</span>
        <input type="text" name="model" form="agent-settings" class="form-field mono" value="${agent.model ?? ''}" placeholder="its default model" list="settings-models" autocomplete="off" data-versioned>
      </label>
    </div>
    <datalist id="settings-models"></datalist>
    <script type="application/json" data-settings-model-suggestions>${unsafeHtml(JSON.stringify(MODEL_SUGGESTIONS).replace(/</g, '\\u003c'))}</script>
    <p class="settings-hint">A prompt step can still pick its own model in the YAML.</p>
  `);

  // ── When it runs ───────────────────────────────────────────────────
  const schedule = agent.schedule ?? '';
  const isPreset = SCHEDULE_PRESETS.some((p) => p.cron === schedule);
  const notLive = schedule && agent.status !== 'active'
    ? html`<p class="settings-hint settings-hint--warn">It's ${agent.status}, so the schedule won't fire until it's active.</p>`
    : html``;
  const runOnValue = agent.runOn ?? '';
  const runOnOption = (val: string) =>
    html`<option value="${val}"${runOnValue === val ? unsafeHtml(' selected') : unsafeHtml('')}>${runOnLabel(val || undefined)}</option>`;
  const whenSection = settingsSection('when', 'When it runs', whenLabel(agent.schedule), html`
    <div class="settings-chips" role="group" aria-label="Schedule presets">
      ${SCHEDULE_PRESETS.map((p) => html`<button type="button" class="settings-chip" data-cron="${p.cron}" aria-pressed="${p.cron === schedule ? 'true' : 'false'}">${p.label}</button>`) as unknown as SafeHtml[]}
    </div>
    ${notLive}
    <details class="settings-more"${!isPreset || runOnValue ? unsafeHtml(' open') : unsafeHtml('')}>
      <summary>More: a custom schedule, or run durably</summary>
      <div class="settings-more__body settings-fields">
        <label class="settings-field">
          <span class="settings-field__label">Custom schedule</span>
          <input type="text" name="schedule" form="agent-settings" class="form-field mono" value="${schedule}" placeholder="0 9 * * 1-5" autocomplete="off" data-settings-schedule>
          <span class="settings-hint">Five fields: minute hour day month weekday. Empty means only when asked.</span>
        </label>
        <label class="settings-field">
          <span class="settings-field__label">Runs</span>
          <select name="runOn" form="agent-settings" class="form-field" data-versioned>${runOnOption('')}${runOnOption('local')}${runOnOption('temporal')}</select>
          <span class="settings-hint">Durable runs survive a restart; they need the dashboard on Temporal and a worker.</span>
        </label>
      </div>
    </details>
  `);

  // ── Where it shows ─────────────────────────────────────────────────
  const where: string[] = [];
  if (agent.pulseVisible !== false) where.push('Pulse');
  if (agent.dashboardVisible !== false) where.push('the agents list');
  if (agent.mcp) where.push('AI apps');
  const widget = agent.outputWidget;
  const whereSection = settingsSection('where', 'Where it shows',
    where.length > 0 ? `On ${where.join(', ')}` : 'Hidden. Still reachable by its link, the scheduler and the runs page.',
    html`
    <div class="settings-switches">
      ${settingsSwitch('pulseVisible', 'Show on Pulse', 'its latest result as a tile', agent.pulseVisible !== false)}
      ${settingsSwitch('dashboardVisible', 'Show in the agents list', '', agent.dashboardVisible !== false)}
      ${settingsSwitch('mcp', 'Let AI apps call it', "Claude Desktop, Cursor and others, through sua's MCP server", !!agent.mcp)}
    </div>
    <div class="settings-row">
      <span class="settings-row__label">Output widget</span>
      <span class="settings-row__value">${widget
        ? (widget.type === 'ai-template' ? 'An AI-made layout' : `${String(widget.fields?.length ?? 0)} field${(widget.fields?.length ?? 0) === 1 ? '' : 's'}${widget.interactive ? ', runs in place' : ''}`)
        : 'None: runs show as text'}</span>
      <a class="btn btn--ghost btn--sm" href="/agents/${id}/output-widget">${widget ? 'Edit' : 'Set up'}</a>
    </div>
  `);

  // ── Connections (own saves) ────────────────────────────────────────
  const notifyBlock = agent.notify
    ? html`<details class="settings-more"><summary>Notify when a run finishes <span class="settings-more__note">set up</span></summary><div class="settings-more__body">${renderNotifyEditor(agent, { integrations: args.availableIntegrations })}</div></details>`
    : html`<details class="settings-more"><summary>Notify when a run finishes <span class="settings-more__note">off</span></summary><div class="settings-more__body"><p class="settings-hint">Send a Slack message or a webhook when a run finishes.</p>${renderNotifyEditor(agent, { integrations: args.availableIntegrations })}</div></details>`;
  const hookOn = !!args.webhook?.hook?.enabled;
  const connectSection = settingsSection('connect', 'Connections',
    `Webhook ${hookOn ? 'on' : 'off'} · notify ${agent.notify ? 'on' : 'off'}`,
    html`
      ${args.webhook ? html`<div class="settings-sub"><h3 class="settings-sub__title">Webhook</h3>${renderWebhookBody(agent, args.webhook.hook, args.webhook.baseUrl)}</div>` : html``}
      ${notifyBlock}
    `, { ownSave: true });

  // ── Access ─────────────────────────────────────────────────────────
  const permImgSrc = agent.permissions?.imgSrc ?? [];
  const inboxRunnable = agent.permissions?.inboxRunnable ?? false;

  // Recently-blocked img-src pills. The CSP-violation listener
  // (csp-img-report.js.ts) reports blocks server-side; this surfaces them
  // as one-click "Allow" buttons that POST to /permissions/allow-host and
  // also clear the underlying suggestion so the pill doesn't linger.
  const blockedHostsBlock = (() => {
    const blocked = (args.blockedImgHosts ?? []).filter((b) => !permImgSrc.includes(b.host));
    if (blocked.length === 0) {
      return html`
        <div data-blocked-host-list="${id}" hidden></div>
      `;
    }
    const pills = blocked.map((b) => html`
      <form method="POST" action="/agents/${id}/permissions/allow-host" data-blocked-host-form
        style="display: inline-flex; margin: 0;">
        <input type="hidden" name="host" value="${b.host}">
        <input type="hidden" name="redirect" value="/agents/${id}/config">
        <button type="submit" class="btn btn--sm btn--ghost mono" title="Allow ${b.host} for this agent">
          + ${b.host}${b.count > 1 ? html` <span class="dim">(${String(b.count)})</span>` : html``}
        </button>
      </form>
    `);
    return html`
      <div data-blocked-host-list="${id}" class="settings-blocked">
        <div class="settings-blocked__head">
          <strong>Recently blocked</strong>
          <form method="POST" action="/api/img-blocks/${id}/dismiss" data-blocked-host-dismiss style="margin: 0;">
            <input type="hidden" name="redirect" value="/agents/${id}/config">
            <button type="submit" class="btn btn--xs btn--ghost">Dismiss all</button>
          </form>
        </div>
        <div class="settings-chips">${pills as unknown as SafeHtml[]}</div>
        <p class="settings-hint">Allowing one saves right away.</p>
      </div>
    `;
  })();

  // Allowed sub-agents: pills are removable; "Add agent…" opens the
  // picklist (allowed-sub-agents-picklist.js.ts). Saves on its own.
  const subAgentsBlock = (() => {
    const list = agent.allowedSubAgents;
    const usingDefault = list === undefined;
    const installedMap = new Map((args.installedAgents ?? []).map((a) => [a.id, a]));
    const pills = (list ?? []).map((aid) => {
      const installed = installedMap.has(aid);
      return html`
        <span class="inbox-pill ${installed ? '' : 'inbox-pill--warn'}" data-sub-agent="${aid}" title="${installed ? '' : 'Not installed: this entry does nothing until the agent is imported.'}">
          ${aid}
          <button type="button" class="inbox-pill__remove" data-sub-agent-remove="${aid}" aria-label="Remove ${aid}">×</button>
        </span>
      `;
    });
    const missingCount = (list ?? []).filter((aid) => !installedMap.has(aid)).length;
    return html`
      <div class="settings-sub">
        <h3 class="settings-sub__title">Agents it can hand work to <span class="settings-more__note">saves on its own</span></h3>
        ${usingDefault
          ? html`<p class="settings-hint">sua's built-in helpers (the default).</p>`
          : html`
            <form method="POST" action="/agents/${id}/allowed-sub-agents" id="allowed-sub-agents-form" style="margin: 0;">
              <input type="hidden" name="agentIds" id="allowed-sub-agents-input" value="${(list ?? []).join(',')}">
            </form>
            <div class="inbox-pills" data-allowed-sub-agents-pills>
              ${pills as unknown as SafeHtml[]}
              ${list && list.length === 0 ? html`<span class="settings-hint">None: it can't hand work off.</span>` : html``}
            </div>
            ${missingCount > 0 ? html`<p class="settings-hint settings-hint--warn">${String(missingCount)} not installed (highlighted).</p>` : html``}
          `}
        <div class="settings-actions">
          <button type="button" class="btn btn--sm" id="allowed-sub-agents-add" data-allowed-sub-agents-open>${usingDefault ? 'Pick agents…' : 'Add agent…'}</button>
          ${usingDefault ? html`` : html`
            <form method="POST" action="/agents/${id}/allowed-sub-agents" style="display:inline;">
              <input type="hidden" name="clear" value="1">
              <button type="submit" class="btn btn--sm btn--ghost">Back to the default</button>
            </form>`}
        </div>
      </div>
    `;
  })();

  const picklistPayload = (args.installedAgents ?? [])
    .filter((a) => a.id !== id)
    .map((a) => ({ id: a.id, name: a.name, description: a.description ?? '' }));
  const allowedSubAgentsPicklist = html`
    <div id="allowed-sub-agents-picklist" hidden data-agent-id="${id}" data-current="${(agent.allowedSubAgents ?? []).join(',')}">
      <script type="application/json" id="allowed-sub-agents-catalog">${JSON.stringify(picklistPayload)}</script>
    </div>
  `;

  const accessSummary = [
    inboxRunnable ? 'sua can run it' : 'sua asks before running it',
    permImgSrc.length > 0 ? `images from ${String(permImgSrc.length)} host${permImgSrc.length === 1 ? '' : 's'}` : '',
    allSecrets.size > 0 ? `${String(allSecrets.size)} secret${allSecrets.size === 1 ? '' : 's'}${secretsMissing > 0 ? ` (${String(secretsMissing)} missing)` : ''}` : '',
  ].filter(Boolean).join(' · ');
  const accessSection = settingsSection('access', 'Access', accessSummary, html`
    <div class="settings-switches">
      ${settingsSwitch('inboxRunnable', 'sua can run it from a conversation', 'without asking you first, when your autonomy setting allows', inboxRunnable, true)}
    </div>
    <label class="settings-field">
      <span class="settings-field__label">Images its widgets may load, one host per line</span>
      ${blockedHostsBlock}
      <textarea name="imgSrc" rows="3" form="agent-settings" class="form-field mono" placeholder="images.unsplash.com&#10;*.unsplash.com" data-versioned>${permImgSrc.join('\n')}</textarea>
    </label>
    ${subAgentsBlock}
    <div class="settings-row">
      <span class="settings-row__label">Secrets</span>
      <span class="settings-row__value">${allSecrets.size === 0 ? 'None needed' : `${String(secretsSet)} set, ${String(secretsMissing)} missing`}</span>
      <a class="btn btn--ghost btn--sm" href="/settings/secrets">Manage</a>
    </div>
  `);

  const content = html`
    <form id="agent-settings" method="POST" action="/agents/${id}/settings" data-settings-form hidden>
      <input type="hidden" name="_fields" value="${BATCHED_FIELDS}">
      <input type="hidden" name="baseVersion" value="${String(agent.version)}">
    </form>
    <div class="settings">
      <nav class="settings-nav" aria-label="Settings sections">
        ${SETTINGS_SECTIONS.map((s) => html`<a class="settings-nav__link" href="#settings-${s.id}" data-settings-nav="${s.id}">${s.label}<span class="settings-nav__dot" aria-hidden="true"></span><span class="settings-nav__sr" data-settings-nav-changed></span></a>`) as unknown as SafeHtml[]}
      </nav>
      <div class="settings-main">
        <form method="POST" action="/agents/${id}/ask-change" class="settings-ask" data-ask-fix>
          <span class="settings-ask__avatar" aria-hidden="true">s</span>
          <label class="settings-ask__label" for="settings-ask-text">Ask sua to change this agent</label>
          <input type="text" id="settings-ask-text" name="text" class="settings-ask__input" required autocomplete="off"
            placeholder="e.g. run it weekdays at 9 on my local model, and let Claude Desktop call it">
          <button type="submit" class="btn btn--sm">Ask sua</button>
        </form>
        ${inputsSection}
        ${modelSection}
        ${whenSection}
        ${whereSection}
        ${connectSection}
        ${accessSection}
        <div class="settings-bar" data-settings-bar hidden role="region" aria-label="Unsaved changes">
          <div class="settings-bar__review" data-settings-review-list hidden></div>
          <div class="settings-bar__row">
            <span class="settings-bar__count" data-settings-count aria-live="polite"></span>
            <button type="button" class="btn btn--ghost btn--sm" data-settings-discard>Discard</button>
            <button type="button" class="btn btn--sm" data-settings-review aria-expanded="false">Review</button>
            <button type="submit" form="agent-settings" class="btn btn--primary btn--sm" data-settings-save data-next-version="${String(agent.version + 1)}">Save</button>
          </div>
        </div>
      </div>
    </div>
    ${allowedSubAgentsPicklist}
  `;

  return agentPageShell({ ...args, activeTab: 'config' }, content);
}

/**
 * Inbound webhook: off by default. On, it shows the URL, the secret (behind
 * a disclosure), a curl example, the last delivery, and rotate / turn off.
 */
function renderWebhookBody(agent: Agent, hook: Webhook | undefined, baseUrl: string): SafeHtml {
  const action = `/agents/${encodeURIComponent(agent.id)}/webhook`;
  const intro = html`<p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
    Lets another service (GitHub, Stripe, Zapier, a script) start this agent with a POST. The request needs this agent's secret; a JSON body's fields fill inputs of the same name, or map them with <code>webhook:</code> in the YAML (see docs/webhooks.md).
  </p>`;
  if (!hook || !hook.enabled) {
    return html`
      ${intro}
      <form method="POST" action="${action}" style="display: flex; gap: var(--space-2); align-items: center;">
        <input type="hidden" name="op" value="enable">
        <span class="badge badge--muted">off</span>
        <button type="submit" class="btn btn--sm">Turn on webhook</button>
      </form>`;
  }
  const url = `${baseUrl.replace(/\/+$/, '')}/hooks/${encodeURIComponent(agent.id)}`;
  const signed = agent.webhook?.signature === 'github';
  const example = signed
    ? `GitHub: Settings → Webhooks → Payload URL ${url}, Content type application/json, Secret = the secret above.`
    : `curl -X POST ${url} \\\n  -H "Authorization: Bearer <secret>" \\\n  -H "Content-Type: application/json" \\\n  -d '{${Object.keys(agent.inputs ?? {}).slice(0, 2).map((k) => `"${k}": "…"`).join(', ')}}'`;
  return html`
    ${intro}
    <dl class="kv" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
      <dt>Status</dt><dd><span class="badge badge--ok">on</span>${signed ? html` <span class="dim">GitHub-signed deliveries only</span>` : html``}</dd>
      <dt>URL</dt><dd class="mono" style="overflow-wrap: anywhere;">POST ${url}</dd>
      <dt>Secret</dt><dd><details><summary class="dim" style="cursor: pointer;">Show</summary><code class="mono" style="overflow-wrap: anywhere;">${hook.token}</code></details></dd>
      <dt>Last delivery</dt><dd>${hook.lastDeliveryAt
        ? html`${formatAge(hook.lastDeliveryAt)} · ${hook.lastStatus ?? ''}${hook.lastRunId && hook.lastStatus === 'started' ? html` · <a class="mono" href="/runs/${encodeURIComponent(hook.lastRunId)}">run ${hook.lastRunId.slice(0, 8)}</a>` : html``} <span class="dim">(${String(hook.deliveries)} in all)</span>`
        : html`<span class="dim">none yet</span>`}</dd>
    </dl>
    <pre class="mono" style="font-size: var(--font-size-xs); white-space: pre-wrap; margin: 0 0 var(--space-3);">${example}</pre>
    <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
      The dashboard listens on this machine only. For a service on the internet to reach it, expose just this path through a tunnel (e.g. <code>cloudflared</code> or <code>ngrok</code> to port ${new URL(url).port || '80'}); the rest of the dashboard stays unreachable through it.
    </p>
    <div style="display: flex; gap: var(--space-2); flex-wrap: wrap;">
      <form method="POST" action="${action}" style="margin: 0;"><input type="hidden" name="op" value="rotate"><button type="submit" class="btn btn--sm">Rotate secret</button></form>
      <form method="POST" action="${action}" style="margin: 0;"><input type="hidden" name="op" value="disable"><button type="submit" class="btn btn--sm btn--warn">Turn off</button></form>
    </div>`;
}
