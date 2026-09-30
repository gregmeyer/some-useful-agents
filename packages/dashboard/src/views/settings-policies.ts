import type { PolicyDecision, PolicyDocument, PolicyRule } from '@some-useful-agents/core';
import { html, type SafeHtml } from './html.js';

const SOURCES = ['local', 'examples', 'community'] as const;
export type PolicySource = typeof SOURCES[number];

export interface PolicyCheck {
  tool: string;
  resource: string;
  source: PolicySource;
  decision: PolicyDecision;
}

/**
 * Settings → Policies: the tool policy in force (read-only) and a "would this
 * be allowed?" checker, the dashboard twin of `sua policy show` / `check`.
 * Editing stays in the file (docs/tool-policies.md).
 */
export function renderSettingsPolicies(args: {
  path: string;
  exists: boolean;
  /** The parsed file; undefined when missing or invalid. */
  doc?: PolicyDocument;
  /** Why the file failed to load, when it did. */
  error?: string;
  /** Tool ids offered in the checker (free text is allowed too). */
  toolIds: string[];
  check?: PolicyCheck;
}): SafeHtml {
  const { path, exists, doc, error, check } = args;
  const deciding = check && check.decision.matchedRuleIndex !== undefined && check.decision.matchedRuleIndex >= 0
    ? check.decision.matchedRuleIndex : undefined;

  const status = error
    ? html`
      <div class="flash flash--error">
        <strong>Every tool call is blocked until this file is fixed.</strong>
        An invalid policy fails closed, so a typo in a deny rule never turns into allow-all.
        <pre class="settings-policies__error">${error}</pre>
      </div>`
    : !exists
      ? html`<p class="flash flash--info">No policy file, so every tool call is allowed. Create <code>${path}</code> to add rules.</p>`
      : html``;

  return html`
    <section class="settings-section">
      <h2 class="mt-0">Policies</h2>
      <p class="dim">
        Which tools agents may call, and on what. sua checks every tool call against these rules,
        whether a flow step runs the tool or a model asks for it.
        <a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/tool-policies.md">How policies work</a>
      </p>
      <p class="settings-policies__file"><span class="dim">File</span> <code>${path}</code></p>
      ${status}
      ${doc ? renderRules(doc, deciding) : html``}
      <p class="dim" style="font-size: var(--font-size-xs);">
        Edit the rules in the file; <code>sua policy validate</code> checks it. Changes apply to the next tool call, no restart needed.
      </p>
      ${renderChecker(args.toolIds, check, error !== undefined)}
    </section>`;
}

function renderRules(doc: PolicyDocument, deciding: number | undefined): SafeHtml {
  const effect = (e: 'allow' | 'deny') => html`<span class="badge ${e === 'deny' ? 'badge--err' : 'badge--ok'}">${e}</span>`;
  const rows = doc.rules.map((r: PolicyRule, i) => html`
    <tr class="${i === deciding ? 'is-deciding' : ''}" id="rule-${String(i)}">
      <td class="dim mono">#${String(i)}</td>
      <td>${effect(r.effect)}</td>
      <td class="mono">${r.tool === '*' ? html`<span class="dim">any tool</span>` : r.tool}</td>
      <td class="mono">${r.resources.length ? r.resources.join(', ') : html`<span class="dim">anything</span>`}</td>
      <td>${r.conditions?.source?.length ? r.conditions.source.join(', ') : html`<span class="dim">any agent</span>`}</td>
      <td class="dim">${r.reason ?? ''}</td>
    </tr>`);
  return html`
    <p>
      <span class="dim">When no rule matches:</span> ${effect(doc.defaultAction)}
      <span class="dim">${doc.defaultAction === 'deny' ? '(only what a rule allows can run)' : '(anything not denied can run)'}</span>
    </p>
    ${doc.rules.length === 0
      ? html`<p class="dim">No rules.</p>`
      : html`
        <table class="table settings-policies__rules">
          <thead><tr><th></th><th>Effect</th><th>Tool</th><th>Resources</th><th>Agents from</th><th>Reason</th></tr></thead>
          <tbody>${rows as unknown as SafeHtml[]}</tbody>
        </table>
        <p class="dim" style="font-size: var(--font-size-xs);">Rules are checked in order and the <strong>last</strong> one that matches decides, so a broad rule can be followed by narrower exceptions.</p>`}`;
}

function renderChecker(toolIds: string[], check: PolicyCheck | undefined, invalid: boolean): SafeHtml {
  const options = toolIds.map((id) => html`<option value="${id}"></option>`);
  const sourceLabel: Record<PolicySource, string> = { local: 'local (yours)', examples: 'examples (bundled)', community: 'community (imported)' };
  const result = check ? renderDecision(check, invalid) : html``;
  return html`
    <section id="check" style="margin-top: var(--space-6);">
      <h3 class="mt-0">Would this be allowed?</h3>
      <p class="dim">Test a call before a run finds out the hard way. Same answer as <code>sua policy check</code>.</p>
      <form method="GET" action="/settings/policies#check" class="settings-pricing__form">
        <label class="settings-pricing__field">
          <span class="dim">Tool</span>
          <input type="text" name="tool" list="policy-tool-ids" required value="${check?.tool ?? ''}" placeholder="web-fetch" style="width: 12rem;">
        </label>
        <label class="settings-pricing__field">
          <span class="dim">Resource</span>
          <input type="text" name="resource" value="${check?.resource ?? ''}" placeholder="https://example.com/page, /abs/path, or a command" style="width: 22rem;">
        </label>
        <label class="settings-pricing__field">
          <span class="dim">Agent from</span>
          <select name="source">
            ${SOURCES.map((s) => html`<option value="${s}" ${check?.source === s ? 'selected' : ''}>${sourceLabel[s]}</option>`) as unknown as SafeHtml[]}
          </select>
        </label>
        <button type="submit" class="btn btn--sm btn--primary">Check</button>
      </form>
      <datalist id="policy-tool-ids">${options as unknown as SafeHtml[]}</datalist>
      ${result}
    </section>`;
}

function renderDecision(check: PolicyCheck, invalid: boolean): SafeHtml {
  const { decision } = check;
  const i = decision.matchedRuleIndex;
  const by = invalid
    ? 'the policy file is invalid'
    : i !== undefined && i >= 0
      ? html`<a href="#rule-${String(i)}">rule #${String(i)}</a> decided it`
      : 'no rule matched, so the default decided it';
  const allowed = decision.effect === 'allow';
  return html`
    <div class="flash ${allowed ? 'flash--ok' : 'flash--error'} settings-policies__result" role="status">
      <strong>${allowed ? 'Allowed' : 'Blocked'}</strong>:
      <span class="mono">${check.tool}</span>${check.resource ? html` on <span class="mono">${check.resource}</span>` : html``}
      for a ${check.source} agent <span class="dim">(${by})</span>.
      ${!allowed && decision.reason && !invalid ? html`<div>${decision.reason}</div>` : html``}
    </div>`;
}
