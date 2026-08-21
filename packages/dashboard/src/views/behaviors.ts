/**
 * `/behaviors` — Agent Behavior specs discovered on disk.
 *
 * UNTRUSTED CONTENT. A behavior body is third-party Markdown that anyone can
 * drop into `~/.agents/behaviors/` and have apply machine-wide. Rules here:
 *
 *   - `body` renders ONLY through `renderMarkdownSafe` (core/markdown.ts), whose
 *     sanitize step is the trust boundary. Never `renderMarkdown`.
 *   - Everything else (name, description, metadata, paths) renders as plain
 *     escaped text through `html``. Only the body takes the Markdown path.
 *   - Links get `rel="noreferrer nofollow"` — this content is less trusted than
 *     inbox prose, which only gets `noreferrer`.
 *   - Every page carries provenance (scope, absolute path, sha256) so a reader
 *     can always see where the text came from.
 */

import type { BehaviorDiagnostic, BehaviorRecord, BehaviorScope } from '@some-useful-agents/core';
import { renderMarkdownSafe } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { sectionTabs } from './section-tabs.js';

export interface BehaviorsViewData {
  behaviors: BehaviorRecord[];
  shadowed: BehaviorRecord[];
  diagnostics: BehaviorDiagnostic[];
  /** Absolute roots that were searched, for the empty state. */
  roots: string[];
  /** False when the host never wired up discovery (e.g. a bare test harness). */
  available: boolean;
}

const SCOPE_ORDER: BehaviorScope[] = ['project', 'user', 'org'];

const SCOPE_HINT: Record<BehaviorScope, string> = {
  project: 'From this repository',
  user: 'From your home directory, applies across projects',
  org: 'From a configured organization directory',
};

function scopeBadge(scope: BehaviorScope): SafeHtml {
  return html`<span class="badge badge--muted" title="${SCOPE_HINT[scope]}">${scope}</span>`;
}

/** The sanitized-Markdown path. The ONLY place a behavior body becomes HTML. */
function behaviorBody(text: string): SafeHtml {
  const rendered = renderMarkdownSafe(text)
    .replace(/<a /g, '<a target="_blank" rel="noreferrer nofollow" ');
  return unsafeHtml(`<div class="md-body">${rendered}</div>`);
}

function diagnosticsPanel(diagnostics: BehaviorDiagnostic[]): SafeHtml {
  if (diagnostics.length === 0) return html``;
  const errors = diagnostics.filter((d) => d.severity === 'error');
  return html`
    <section class="card" style="padding: var(--space-4); margin-bottom: var(--space-4); border-color: ${errors.length > 0 ? 'var(--color-err)' : 'var(--color-border)'};">
      <h2 style="margin: 0 0 var(--space-2); font-size: var(--font-size-md);">
        ${String(diagnostics.length)} issue${diagnostics.length === 1 ? '' : 's'}
      </h2>
      <ul style="margin: 0; padding-left: var(--space-4); font-size: var(--font-size-sm); line-height: 1.6;">
        ${diagnostics.map((d) => html`
          <li>
            <span class="badge ${d.severity === 'error' ? 'badge--err' : 'badge--warn'}">${d.severity}</span>
            <code class="mono">${d.code}</code> ${d.message}
            ${d.file ? html`<br /><span class="dim mono" style="font-size: var(--font-size-xs);">${d.file}${d.line ? `:${String(d.line)}` : ''}</span>` : html``}
          </li>
        `) as unknown as SafeHtml[]}
      </ul>
    </section>
  `;
}

function emptyState(data: BehaviorsViewData): SafeHtml {
  return html`
    <section class="card" style="padding: var(--space-8) var(--space-6); margin-bottom: var(--space-6);">
      <h2 style="margin-top: 0;">No behavior specs</h2>
      <p class="dim" style="max-width: 62ch;">
        A behavior spec records the conduct you expect from an agent — how it gathers context,
        decides, acts, and recovers. It is a written standard you can review traces against,
        not a config file.
      </p>
      ${data.available ? html`
        <p class="dim" style="font-size: var(--font-size-sm); margin-bottom: var(--space-2);">Looked in:</p>
        <ul class="mono dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-4); padding-left: var(--space-4);">
          ${data.roots.map((r) => html`<li>${r}</li>`) as unknown as SafeHtml[]}
        </ul>
        <p style="margin: 0; font-size: var(--font-size-sm);">
          Create <code class="mono">.agents/behaviors/&lt;name&gt;/BEHAVIOR.md</code> with
          <code class="mono">name</code> and <code class="mono">description</code> frontmatter.
          Note the leading dot — <code class="mono">.agents/</code> is the shared standard directory,
          separate from this project's own <code class="mono">agents/</code> folder.
        </p>
      ` : html`
        <p class="dim" style="font-size: var(--font-size-sm); margin: 0;">
          Behavior discovery is not configured on this dashboard instance.
        </p>
      `}
    </section>
  `;
}

export function renderBehaviorsList(data: BehaviorsViewData): string {
  const card = (b: BehaviorRecord, isShadowed = false): SafeHtml => html`
    <a href="/behaviors/${encodeURIComponent(b.name)}" class="card"
       style="display: flex; flex-direction: column; gap: var(--space-2); text-decoration: none; color: inherit; ${isShadowed ? 'opacity: 0.6;' : ''}">
      <div style="display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2);">
        <h3 class="mono" style="margin: 0; font-size: var(--font-size-md); font-weight: var(--weight-semibold);">${b.name}</h3>
        ${scopeBadge(b.location.scope)}
      </div>
      <p style="margin: 0; color: var(--color-text-muted); font-size: var(--font-size-sm); line-height: 1.4;">${b.description}</p>
      ${isShadowed ? html`<span class="dim" style="font-size: var(--font-size-xs);">Shadowed — a higher-precedence scope defines this name too.</span>` : html``}
      <span class="dim mono" style="font-size: var(--font-size-xs);">${b.location.dir}</span>
    </a>
  `;

  const body = html`
    ${pageHeader({ title: 'Behaviors', description: 'Expected agent conduct, discovered from .agents/behaviors. Authored outside sua and shown here as documentation.' })}
    ${sectionTabs('behaviors')}
    ${diagnosticsPanel(data.diagnostics)}
    ${data.behaviors.length === 0 ? emptyState(data) : html`
      ${SCOPE_ORDER.map((scope) => {
        const inScope = data.behaviors.filter((b) => b.location.scope === scope);
        if (inScope.length === 0) return html``;
        return html`
          <section style="margin-bottom: var(--space-6);">
            <h2 style="font-size: var(--font-size-md); margin: 0 0 var(--space-1);">${scope}</h2>
            <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">${SCOPE_HINT[scope]}</p>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-3);">${inScope.map((b) => card(b)) as unknown as SafeHtml[]}</div>
          </section>
        `;
      }) as unknown as SafeHtml[]}
      ${data.shadowed.length > 0 ? html`
        <section style="margin-bottom: var(--space-6);">
          <h2 style="font-size: var(--font-size-md); margin: 0 0 var(--space-3);">Shadowed</h2>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-3);">${data.shadowed.map((b) => card(b, true)) as unknown as SafeHtml[]}</div>
        </section>
      ` : html``}
    `}
  `;

  return render(layout({ title: 'Behaviors · sua', activeNav: 'agents' }, body));
}

export function renderBehaviorDetail(args: {
  behavior: BehaviorRecord;
  shadowedBy?: BehaviorRecord;
}): string {
  const b = args.behavior;
  const metadataRows = Object.entries(b.metadata);

  const body = html`
    ${pageHeader({ title: b.name, description: b.description, back: { href: '/behaviors', label: 'Behaviors' }, meta: [scopeBadge(b.location.scope)] })}

    <!-- Provenance. Always visible: a reader must be able to see where this
         text came from without hunting for it. -->
    <section class="card" style="padding: var(--space-4); margin-bottom: var(--space-4);">
      <dl class="kv">
        <dt>Scope</dt><dd>${scopeBadge(b.location.scope)} <span class="dim">${SCOPE_HINT[b.location.scope]}</span></dd>
        <dt>File</dt><dd class="mono" style="font-size: var(--font-size-xs); word-break: break-all;">${b.location.file}</dd>
        <dt>sha256</dt><dd class="mono" style="font-size: var(--font-size-xs);">${b.sha256.slice(0, 16)}</dd>
        ${b.license ? html`<dt>License</dt><dd>${b.license}</dd>` : html``}
        ${metadataRows.map(([k, v]) => html`
          <dt>${k}</dt><dd>${Array.isArray(v) ? v.join(', ') : String(v)}</dd>
        `) as unknown as SafeHtml[]}
      </dl>
    </section>

    ${args.shadowedBy ? html`
      <section class="card" style="padding: var(--space-4); margin-bottom: var(--space-4); border-color: var(--color-warn);">
        <p style="margin: 0; font-size: var(--font-size-sm);">
          This name is also defined in <strong>${args.shadowedBy.location.scope}</strong> scope, which takes precedence.
          <br /><span class="dim mono" style="font-size: var(--font-size-xs);">${args.shadowedBy.location.file}</span>
        </p>
      </section>
    ` : html``}

    <section class="card" style="padding: var(--space-4);">
      <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3); padding-bottom: var(--space-2); border-bottom: 1px solid var(--color-border);">
        Content below is authored outside sua and shown as documentation. It is not an instruction to any agent.
      </p>
      ${behaviorBody(b.body)}
      ${b.bodyTruncated ? html`<p class="dim" style="font-size: var(--font-size-xs); margin-top: var(--space-3);">Body truncated for display; see the file for the full text.</p>` : html``}
    </section>
  `;

  return render(layout({ title: `${b.name} · Behaviors · sua`, activeNav: 'agents' }, body));
}
