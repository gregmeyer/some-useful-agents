import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import type { BuiltinReadiness, CustomReadiness } from '../lib/provider-readiness.js';

export interface ConnectModelArgs {
  builtins: BuiltinReadiness[];
  customs: CustomReadiness[];
  /** True when something already resolves — the page becomes informational. */
  ready: boolean;
  error?: string;
  flash?: string;
  /** Probe result for the endpoint the operator just tried to save. */
  probe?: { ok: boolean; message: string };
  /** Sticky form values so a failed save doesn't wipe what was typed. */
  form?: { mode?: 'hosted' | 'local'; apiBase?: string; model?: string; name?: string };
  /** Render the "save anyway" affordance (probe failed but the config may be fine). */
  offerForce?: boolean;
}

const DETECT_HINT: Record<string, string> = {
  claude: 'not installed',
  codex: 'not installed',
  'apple-foundation-models': 'needs macOS 26+ with Apple Intelligence',
};

function field(args: {
  id: string;
  name: string;
  label: string;
  note?: string;
  value?: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
}): SafeHtml {
  return html`
    <div class="connect-field">
      <label class="connect-field__label" for="${args.id}">
        ${args.label}${args.note ? html` <span>${args.note}</span>` : html``}
      </label>
      <input id="${args.id}" name="${args.name}" class="form-field"
        type="${args.type ?? 'text'}"
        ${args.type === 'password' ? unsafeHtml('autocomplete="off"') : html``}
        value="${args.value ?? ''}"
        placeholder="${args.placeholder ?? ''}"
        ${args.required ? unsafeHtml('required') : html``}>
    </div>
  `;
}

/**
 * The first-run "Connect a model" screen.
 *
 * Two routes, numbered, because the two audiences are genuinely different:
 * someone with an API key wants to paste it and move on, someone running
 * Ollama/LM Studio wants a URL field with a sane default. Both land in the
 * same place — a custom OpenAI-compatible provider promoted to the front of
 * the waterfall.
 */
export function renderConnectModelPage(args: ConnectModelArgs): string {
  const f = args.form ?? {};

  const banner = (kind: 'ok' | 'error', message: SafeHtml) => html`
    <div class="flash flash--${kind}" style="margin-bottom: var(--space-4);">${message}</div>
  `;

  const banners = html`
    ${args.error ? banner('error', html`${args.error}`) : html``}
    ${args.flash ? banner('ok', html`${args.flash}`) : html``}
    ${args.probe
      ? banner(args.probe.ok ? 'ok' : 'error', html`
          ${args.probe.ok ? 'Endpoint reachable' : "That endpoint didn't answer"} · ${args.probe.message}
        `)
      : html``}
  `;

  // "Save anyway" replays the same submission with force=1. Rendered only
  // after a probe failure, so the operator makes that call knowingly rather
  // than being blocked by a server that happens to be asleep.
  const forceBlock = args.offerForce
    ? html`
      <form method="POST" action="/connect-model/connect" class="connect__section">
        <input type="hidden" name="mode" value="${f.mode ?? 'hosted'}">
        <input type="hidden" name="apiBase" value="${f.apiBase ?? ''}">
        <input type="hidden" name="model" value="${f.model ?? ''}">
        <input type="hidden" name="name" value="${f.name ?? ''}">
        <input type="hidden" name="force" value="1">
        <p class="connect__section-note">
          The settings may still be right — the server might not be started yet,
          or it might not serve <code>/models</code>. Saving without a key is
          also fine; you can fix it later in Settings.
        </p>
        <button type="submit" class="btn btn--sm">Save anyway</button>
      </form>
    `
    : html``;

  // The API key is deliberately NOT replayed into the sticky form: a failed
  // probe re-render should never put a secret back into an HTML value.
  const hostedCard = html`
    <section class="connect-card">
      <div class="connect-card__head">
        <span class="connect-card__ord">01 · Hosted</span>
        <h2 class="connect-card__title">Paste an API key</h2>
        <p class="connect-card__sub">Fastest if you already have one.</p>
      </div>
      <div class="connect-card__body">
        <form method="POST" action="/connect-model/connect" class="connect-card__form">
          <input type="hidden" name="mode" value="hosted">
          ${field({
            id: 'hosted-base', name: 'apiBase', label: 'API base URL',
            value: f.mode === 'hosted' ? f.apiBase : '',
            placeholder: 'https://api.openai.com/v1', required: true,
          })}
          ${field({
            id: 'hosted-model', name: 'model', label: 'Model',
            value: f.mode === 'hosted' ? f.model : '',
            placeholder: 'gpt-4o-mini', required: true,
          })}
          ${field({
            id: 'hosted-key', name: 'apiKey', label: 'API key',
            type: 'password', placeholder: 'sk-…', required: true,
          })}
          <div class="connect-card__actions">
            <button type="submit" class="btn btn--primary">Connect</button>
          </div>
        </form>
        <p class="connect-card__hint">
          Works with anything speaking the OpenAI <code>/v1/chat/completions</code>
          API — OpenAI, Groq, Together, OpenRouter, a gateway. The key is written
          to <code>llm-settings.json</code> on this machine and sent only to the
          endpoint above.
        </p>
      </div>
    </section>
  `;

  const localCard = html`
    <section class="connect-card">
      <div class="connect-card__head">
        <span class="connect-card__ord">02 · Local</span>
        <h2 class="connect-card__title">Run it yourself</h2>
        <p class="connect-card__sub">No key, no bill, nothing leaves the box.</p>
      </div>
      <div class="connect-card__body">
        <form method="POST" action="/connect-model/connect" class="connect-card__form">
          <input type="hidden" name="mode" value="local">
          ${field({
            id: 'local-base', name: 'apiBase', label: 'API base URL',
            value: f.mode === 'local' ? f.apiBase : 'http://127.0.0.1:11434/v1',
            required: true,
          })}
          ${field({
            id: 'local-model', name: 'model', label: 'Model',
            value: f.mode === 'local' ? f.model : '',
            placeholder: 'llama3.2', required: true,
          })}
          ${field({
            id: 'local-key', name: 'apiKey', label: 'API key', note: '(optional)',
            type: 'password', placeholder: 'most local servers ignore this',
          })}
          <div class="connect-card__actions">
            <button type="submit" class="btn btn--primary">Connect</button>
          </div>
        </form>
        <p class="connect-card__hint">
          Ollama <code>:11434/v1</code> · LM Studio <code>:1234/v1</code> ·
          llama.cpp <code>:8080/v1</code> · vLLM <code>:8000/v1</code>.
          Start the server first so the check below can reach it.
        </p>
      </div>
    </section>
  `;

  const detectedRows = args.builtins.map((b) => html`
    <div class="connect-row ${b.installed ? '' : 'connect-row--off'}">
      <span class="connect-row__name">${b.binary}</span>
      <span class="connect-row__meta">${b.displayName}${b.installed && b.version ? ` · ${b.version}` : ''}</span>
      <span class="connect-row__tail">
        ${b.installed
          ? html`<span class="badge badge--ok">Detected</span>`
          : html`<span class="connect-row__hint">${DETECT_HINT[b.id] ?? 'not on PATH'}</span>`}
      </span>
    </div>
  `);

  const customRows = args.customs.map((c) => html`
    <div class="connect-row">
      <span class="connect-row__name">${c.name}</span>
      <span class="connect-row__meta">${c.apiBase} · ${c.model}${c.hasKey ? ' · key ••••' : ' · no key'}</span>
      <span class="connect-row__tail"><span class="badge badge--ok">Connected</span></span>
    </div>
  `);

  const detectedSection = html`
    <section class="connect__section">
      <p class="connect__section-label">Detected on this machine</p>
      <p class="connect__section-note">
        sua can also drive a local CLI directly, with no configuration at all.
      </p>
      ${detectedRows as unknown as SafeHtml[]}
    </section>
  `;

  const connectedSection = args.customs.length > 0
    ? html`
      <section class="connect__section">
        <p class="connect__section-label">Connected endpoints</p>
        ${customRows as unknown as SafeHtml[]}
      </section>
    `
    : html``;

  const body = html`
    <div class="connect">
      <p class="connect__kicker">${args.ready ? 'Models' : 'Setup'}</p>
      <h1 class="connect__title">
        ${args.ready ? 'Your models' : 'Give sua something to think with'}
      </h1>
      <p class="connect__lede">
        ${args.ready
          ? 'At least one model resolves, so llm-prompt agents will run. Add another route below, or manage the full fallback waterfall in Settings.'
          : 'Agents run shell commands on their own, but the interesting ones call a model. Connect one and the rest of the dashboard comes alive. You can change this later.'}
      </p>

      ${banners}
      ${forceBlock}

      <div class="connect__grid">
        ${hostedCard}
        ${localCard}
      </div>

      ${detectedSection}
      ${connectedSection}

      <div class="connect__foot">
        ${args.ready
          ? html`<a class="btn btn--primary" href="/">Go to dashboard</a>`
          : html`
            <form method="POST" action="/connect-model/skip">
              <button type="submit" class="btn btn--ghost">Skip for now</button>
            </form>
            <span class="connect__foot-note">
              Shell agents still work; llm-prompt agents will fail until a model is connected.
            </span>
          `}
        <a class="connect__foot-end" href="/settings/llm">Advanced provider settings →</a>
      </div>
    </div>
  `;

  // No activeNav: this is a first-run setup screen that is not in the nav, and
  // highlighting Settings told the reader they had navigated somewhere they
  // hadn't. `activeNav` is optional, so nothing lights up.
  return render(layout({ title: 'Connect a model' }, body));
}
