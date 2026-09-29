import { formatTokens, formatUsd, type SpendLimits, type UsageSummary } from '@some-useful-agents/core';
import { html, type SafeHtml } from './html.js';

/**
 * Settings → Usage: what runs cost over the last N days, by agent and by
 * provider/model. USD at list price (docs/cost.md).
 */
export function renderSettingsUsage(args: {
  summary: UsageSummary;
  days: number;
  /** Default limits; undefined when the settings store isn't wired. */
  limits?: SpendLimits;
  /** Enabled providers with no price, whose runs don't count toward a limit. */
  unenforceable?: string[];
}): SafeHtml {
  const { summary, days } = args;
  const range = (d: number) => html`<a href="/settings/usage?days=${String(d)}" class="${d === days ? 'is-active' : ''}">${String(d)} days</a>`;
  const unpriced = summary.byProvider.filter((p) => p.unpricedTokens > 0);

  const agentRows = summary.byAgent.map((a) => html`
    <tr>
      <td><a href="/agents/${encodeURIComponent(a.agent)}">${a.agent}</a></td>
      <td class="mono">${formatUsd(a.costUsd, a.costComplete)}</td>
      <td class="dim">${String(a.runs)}</td>
      <td class="dim mono">${formatUsd(a.runs ? a.costUsd / a.runs : 0, a.costComplete)}</td>
      <td class="dim mono">${formatTokens(a.inputTokens)} / ${formatTokens(a.outputTokens)}</td>
    </tr>`);

  const providerRows = summary.byProvider.map((p) => html`
    <tr>
      <td class="mono">${p.provider}${p.model ? html`<span class="dim">/${p.model}</span>` : html``}</td>
      <td class="mono">${p.unpricedTokens > 0 && p.costUsd === 0 ? html`<span class="dim">no price</span>` : formatUsd(p.costUsd, p.unpricedTokens === 0)}</td>
      <td class="dim">${String(p.calls)}</td>
      <td class="dim mono">${formatTokens(p.inputTokens)} / ${formatTokens(p.outputTokens)}</td>
      <td class="dim">${p.sources.join(', ')}</td>
    </tr>`);

  return html`
    <section class="settings-section">
      <h2 class="mt-0">Usage</h2>
      <p class="dim">
        What agent runs cost, in USD at list price: what the same usage costs on the API. On a
        subscription that is not your bill, but it is the number to budget against. A run's cost
        includes the agents it called. Recorded from this version on; older runs show no cost.
      </p>
      <nav class="tab-strip" aria-label="Period" style="margin-bottom: var(--space-4);">${range(1)}${range(7)}${range(30)}</nav>

      <p style="font-size: var(--font-size-lg); margin: 0 0 var(--space-4);">
        <span class="mono">${formatUsd(summary.totalUsd, summary.complete)}</span>
        <span class="dim" style="font-size: var(--font-size-sm);">in the last ${String(days)} day${days === 1 ? '' : 's'}</span>
      </p>
      ${unpriced.length > 0 ? html`
        <div class="flash flash--info" style="margin-bottom: var(--space-4);">
          ${unpriced.map((p) => p.provider).filter((v, i, a) => a.indexOf(v) === i).join(', ')} used
          ${formatTokens(unpriced.reduce((s, p) => s + p.unpricedTokens, 0))} tokens with no price, so the totals are a lower bound.
          <a href="/settings/llm#pricing">Set a price</a> to estimate them.
        </div>` : html``}

      ${args.limits !== undefined ? renderLimitsForm(args.limits, args.unenforceable ?? []) : html``}

      <h3>By agent</h3>
      ${summary.byAgent.length === 0
        ? html`<p class="dim">No runs with recorded usage in this period.</p>`
        : html`<table class="table">
            <thead><tr><th>Agent</th><th>Cost</th><th>Runs</th><th>Per run</th><th>Tokens in / out</th></tr></thead>
            <tbody>${agentRows as unknown as SafeHtml[]}</tbody>
          </table>`}

      <h3 style="margin-top: var(--space-6);">By provider</h3>
      ${summary.byProvider.length === 0
        ? html`<p class="dim">No model calls in this period.</p>`
        : html`<table class="table">
            <thead><tr><th>Provider / model</th><th>Cost</th><th>Calls</th><th>Tokens in / out</th><th>Cost from</th></tr></thead>
            <tbody>${providerRows as unknown as SafeHtml[]}</tbody>
          </table>
          <p class="dim" style="font-size: var(--font-size-xs);">A call is one provider attempt; a node that fell back from one provider to another counts on both.</p>`}
    </section>
  `;
}

/** Default spend limits for agents without their own `spendLimit:`. */
function renderLimitsForm(limits: SpendLimits, unenforceable: string[]): SafeHtml {
  const field = (name: 'perRunUsd' | 'perDayUsd', label: string, hint: string) => html`
    <label class="settings-pricing__field">
      <span class="dim">${label}</span>
      <input type="number" name="${name}" min="0" step="any" inputmode="decimal" placeholder="no limit"
        value="${limits[name] === undefined ? '' : String(limits[name])}" style="width: 8rem;" aria-describedby="${name}-hint">
      <span class="dim" id="${name}-hint">${hint}</span>
    </label>`;
  return html`
    <section style="margin: var(--space-4) 0 var(--space-6);" id="limits">
      <h3 class="mt-0">Spend limits</h3>
      <p class="dim">
        Defaults for every agent that doesn't set its own <code>spendLimit:</code>. A run that reaches
        its per-run limit stops (the model finishes the turn it's on, so it can go slightly over), and
        once an agent reaches its daily limit its new runs fail straight away until midnight, with one
        inbox item saying so. Leave a field empty for no limit.
      </p>
      <form method="POST" action="/settings/usage/limits" class="settings-pricing__form">
        ${field('perRunUsd', 'Per run (USD)', 'each run, incl. agents it calls')}
        ${field('perDayUsd', 'Per agent, per day (USD)', 'resets at midnight')}
        <button type="submit" class="btn btn--sm btn--primary">Save limits</button>
      </form>
      ${unenforceable.length > 0 ? html`
        <p class="flash flash--warn" style="margin-top: var(--space-3);">
          ${unenforceable.join(', ')} ${unenforceable.length === 1 ? 'has' : 'have'} no price, so ${unenforceable.length === 1 ? 'its' : 'their'} runs don't count toward these limits.
          <a href="/settings/llm#pricing">Set a price</a>.
        </p>` : html``}
    </section>`;
}
