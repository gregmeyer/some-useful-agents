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
 * Settings → Policies: the tool policy in force, editable, plus a "would this
 * be allowed?" checker (the dashboard twin of `sua policy show` / `check`).
 * Every edit form carries the file's `version`, so a save never overwrites a
 * change made elsewhere in between (core savePolicyDocument).
 */
export function renderSettingsPolicies(args: {
  path: string;
  exists: boolean;
  /** The parsed file; undefined when missing or invalid. */
  doc?: PolicyDocument;
  /** Why the file failed to load, when it did. */
  error?: string;
  /** Tool ids offered in the checker and the rule form (free text is allowed too). */
  toolIds: string[];
  check?: PolicyCheck;
  /** Fingerprint of the file as read ('' = no file); sent back with every edit. */
  version?: string;
  /** The rule being edited: its index, or 'new'. */
  editing?: number | 'new';
  /** The file's text, for the JSON editor. */
  rawText?: string;
  /** A previous version exists (Undo). */
  canUndo?: boolean;
}): SafeHtml {
  const { path, exists, doc, error, check } = args;
  const version = args.version ?? '';
  const deciding = check && check.decision.matchedRuleIndex !== undefined && check.decision.matchedRuleIndex >= 0
    ? check.decision.matchedRuleIndex : undefined;

  const status = error
    ? html`
      <div class="flash flash--error">
        <strong>Every tool call is blocked until this file is fixed.</strong>
        An invalid policy fails closed, so a typo in a deny rule never turns into allow-all.
        Fix it under <a href="#json">Edit as JSON</a> below${args.canUndo ? html`, or undo the last change` : html``}.
        <pre class="settings-policies__error">${error}</pre>
      </div>`
    : !exists
      ? html`<p class="flash flash--info">No policy file yet, so every tool call is allowed. Adding a rule creates <code>${path}</code>.</p>`
      : html``;

  const undo = args.canUndo
    ? html`<form method="POST" action="/settings/policies/undo" class="settings-policies__inline">
        <input type="hidden" name="version" value="${version}">
        <button type="submit" class="btn btn--ghost btn--sm" title="Put back the file as it was before the last change">Undo last change</button>
      </form>`
    : html``;

  return html`
    <section class="settings-section">
      <h2 class="mt-0">Policies</h2>
      <p class="dim">
        Which tools agents may call, and on what. sua checks every tool call against these rules,
        whether a flow step runs the tool or a model asks for it. Changes apply to the next tool call, no restart needed.
        <a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/tool-policies.md">How policies work</a>
      </p>
      <p class="settings-policies__file"><span class="dim">File</span> <code>${path}</code> ${undo}</p>
      ${status}
      ${error ? html`` : renderRules(doc ?? { version: 1, defaultAction: 'allow', rules: [] }, deciding, version, args.editing, args.toolIds)}
      ${renderJsonEditor(args.rawText ?? '', version, error !== undefined)}
      ${renderChecker(args.toolIds, check, error !== undefined)}
    </section>`;
}

const effectBadge = (e: 'allow' | 'deny') => html`<span class="badge ${e === 'deny' ? 'badge--err' : 'badge--ok'}">${e}</span>`;

function renderRules(doc: PolicyDocument, deciding: number | undefined, version: string, editing: number | 'new' | undefined, toolIds: string[]): SafeHtml {
  const last = doc.rules.length - 1;
  const post = (action: string, label: string, title: string, extra: SafeHtml = html``) => html`
    <form method="POST" action="${action}" class="settings-policies__inline">
      <input type="hidden" name="version" value="${version}">${extra}
      <button type="submit" class="btn btn--ghost btn--sm" title="${title}" aria-label="${title}">${label}</button>
    </form>`;
  const rows = doc.rules.map((r: PolicyRule, i) => i === editing
    ? html`<tr id="rule-${String(i)}" class="is-editing"><td colspan="7">${renderRuleForm(r, i, version, toolIds)}</td></tr>`
    : html`
    <tr class="${i === deciding ? 'is-deciding' : ''}" id="rule-${String(i)}">
      <td class="dim mono">#${String(i)}</td>
      <td>${effectBadge(r.effect)}</td>
      <td class="mono">${r.tool === '*' ? html`<span class="dim">any tool</span>` : r.tool}</td>
      <td class="mono">${r.resources.length ? r.resources.join(', ') : html`<span class="dim">anything</span>`}</td>
      <td>${r.conditions?.source?.length ? r.conditions.source.join(', ') : html`<span class="dim">any agent</span>`}</td>
      <td class="dim">${r.reason ?? ''}</td>
      <td class="settings-policies__actions">
        <a class="btn btn--ghost btn--sm" href="/settings/policies?edit=${String(i)}#rule-${String(i)}">Edit</a>
        ${i > 0 ? post(`/settings/policies/rules/${String(i)}/move`, '↑', `Move rule #${String(i)} up`, html`<input type="hidden" name="dir" value="up">`) : html`<span class="settings-policies__spacer" aria-hidden="true">↑</span>`}
        ${i < last ? post(`/settings/policies/rules/${String(i)}/move`, '↓', `Move rule #${String(i)} down`, html`<input type="hidden" name="dir" value="down">`) : html`<span class="settings-policies__spacer" aria-hidden="true">↓</span>`}
        ${post(`/settings/policies/rules/${String(i)}/delete`, 'Delete', `Delete rule #${String(i)}`)}
      </td>
    </tr>`);
  const defaultForm = html`
    <form method="POST" action="/settings/policies/default" class="settings-policies__default">
      <input type="hidden" name="version" value="${version}">
      <label for="policy-default" class="dim">When no rule matches:</label>
      <select id="policy-default" name="defaultAction">
        <option value="allow" ${doc.defaultAction === 'allow' ? 'selected' : ''}>allow (anything not denied can run)</option>
        <option value="deny" ${doc.defaultAction === 'deny' ? 'selected' : ''}>deny (only what a rule allows can run)</option>
      </select>
      <button type="submit" class="btn btn--sm">Save</button>
    </form>`;
  return html`
    ${defaultForm}
    <div id="rules">
    ${doc.rules.length === 0
      ? html`<p class="dim">No rules.</p>`
      : html`
        <table class="table settings-policies__rules">
          <thead><tr><th></th><th>Effect</th><th>Tool</th><th>Resources</th><th>Agents from</th><th>Reason</th><th></th></tr></thead>
          <tbody>${rows as unknown as SafeHtml[]}</tbody>
        </table>
        <p class="dim" style="font-size: var(--font-size-xs);">Rules are checked in order and the <strong>last</strong> one that matches decides, so a broad rule can be followed by narrower exceptions.</p>`}
    ${editing === 'new'
      ? html`<div id="rule-new" class="settings-policies__new">${renderRuleForm(undefined, 'new', version, toolIds)}</div>`
      : html`<a class="btn btn--sm" href="/settings/policies?edit=new#rule-new">Add a rule</a>`}
    </div>`;
}

function renderRuleForm(rule: PolicyRule | undefined, index: number | 'new', version: string, toolIds: string[]): SafeHtml {
  const sources = new Set(rule?.conditions?.source ?? []);
  const sourceLabel: Record<PolicySource, string> = { local: 'local (yours)', examples: 'examples (bundled)', community: 'community (imported)' };
  const effect = rule?.effect ?? 'deny';
  const id = `rule-form-${String(index)}`;
  return html`
    <form method="POST" action="/settings/policies/rules" class="settings-policies__form" aria-label="${index === 'new' ? 'New rule' : `Edit rule #${String(index)}`}">
      <input type="hidden" name="version" value="${version}">
      <input type="hidden" name="index" value="${index === 'new' ? '' : String(index)}">
      <p class="mt-0"><strong>${index === 'new' ? 'New rule' : `Rule #${String(index)}`}</strong>
        ${index === 'new' ? html`<span class="dim">: added at the end, so it wins over earlier rules that match the same call.</span>` : html``}</p>
      <fieldset class="settings-policies__effect">
        <legend class="dim">Effect</legend>
        <label><input type="radio" name="effect" value="deny" ${effect === 'deny' ? 'checked' : ''}> deny</label>
        <label><input type="radio" name="effect" value="allow" ${effect === 'allow' ? 'checked' : ''}> allow</label>
      </fieldset>
      <label class="settings-pricing__field" for="${id}-tool">
        <span class="dim">Tool</span>
        <input type="text" id="${id}-tool" name="tool" list="policy-tool-ids" required value="${rule?.tool ?? ''}" placeholder="web-fetch, or * for any tool" style="width: 16rem;">
      </label>
      <label class="settings-pricing__field" for="${id}-resources">
        <span class="dim">Resources, one per line (empty = anything)</span>
        <textarea id="${id}-resources" name="resources" rows="3" class="settings-policies__resources" placeholder="https://docs.example.com/*&#10;/Users/me/projects/**">${(rule?.resources ?? []).join('\n')}</textarea>
        <span class="dim settings-policies__hint">Globs on the URL, absolute file path, or command the tool would touch. <code>*</code> stays within one path segment, <code>**</code> crosses them.</span>
      </label>
      <fieldset class="settings-policies__sources">
        <legend class="dim">Applies to agents from (none ticked = all)</legend>
        ${SOURCES.map((s) => html`<label><input type="checkbox" name="source" value="${s}" ${sources.has(s) ? 'checked' : ''}> ${sourceLabel[s]}</label>`) as unknown as SafeHtml[]}
      </fieldset>
      <label class="settings-pricing__field" for="${id}-reason">
        <span class="dim">Reason (shown when it blocks a call)</span>
        <input type="text" id="${id}-reason" name="reason" value="${rule?.reason ?? ''}" maxlength="300" style="width: 100%;">
      </label>
      <div class="settings-policies__form-actions">
        <button type="submit" class="btn btn--sm btn--primary">${index === 'new' ? 'Add rule' : 'Save rule'}</button>
        <a class="btn btn--ghost btn--sm" href="/settings/policies#rules">Cancel</a>
      </div>
    </form>`;
}

function renderJsonEditor(text: string, version: string, invalid: boolean): SafeHtml {
  return html`
    <details id="json" class="settings-policies__json" ${invalid ? 'open' : ''}>
      <summary>Edit as JSON</summary>
      <form method="POST" action="/settings/policies/raw">
        <input type="hidden" name="version" value="${version}">
        <textarea name="text" rows="14" spellcheck="false" class="settings-policies__json-text" aria-label="Policy file JSON">${text || '{\n  "version": 1,\n  "defaultAction": "allow",\n  "rules": []\n}\n'}</textarea>
        <p class="dim settings-policies__hint">Saved only if it's valid, so this can't leave you with a file that blocks everything.</p>
        <button type="submit" class="btn btn--sm">Save JSON</button>
      </form>
    </details>`;
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
