import type { Agent, AgentVersion } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { formatAge } from './components.js';

/**
 * Render the version history list for a single agent. Each row links to
 * the single-version viewer and — for any row that isn't currently
 * active — offers a "Rollback to v<N>" form that POSTs to the rollback
 * endpoint. Rollback always creates a NEW version (not a pointer move)
 * so the history stays append-only.
 */
export function renderVersionsList(args: {
  agent: Agent;
  versions: AgentVersion[];
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}): string {
  const { agent, versions, flash } = args;

  const rows = versions.map((v) => {
    const isCurrent = v.version === agent.version;
    const rollbackButton = isCurrent
      ? html`<span class="dim subtle">current</span>`
      : html`
          <form method="POST" action="/agents/${agent.id}/rollback" style="margin: 0;">
            <input type="hidden" name="targetVersion" value="${String(v.version)}">
            <button type="submit" class="btn btn--sm"
              onclick="return confirm('Rollback agent \\'${agent.id}\\' to v${String(v.version)}? This creates a new version whose DAG matches v${String(v.version)}; nothing is deleted.');">
              Rollback to v${String(v.version)}
            </button>
          </form>
        `;
    return html`
      <tr ${isCurrent ? unsafeHtml('style="background: var(--color-surface-raised);"') : unsafeHtml('')}>
        <td>
          <a href="/agents/${agent.id}/versions/${String(v.version)}" class="mono">
            v${String(v.version)}
          </a>
          ${isCurrent ? html` <span class="badge badge--ok">current</span>` : html``}
        </td>
        <td class="dim">${formatAge(v.createdAt)}</td>
        <td class="mono dim">${v.createdBy}</td>
        <td class="dim">${v.commitMessage ?? ''}</td>
        <td>${rollbackButton}</td>
      </tr>
    `;
  });

  const body = html`
    ${pageHeader({
      title: `${agent.id} \u2014 versions`,
      back: { href: `/agents/${agent.id}`, label: `Back to ${agent.id}` },
      description: `Every save creates a new version. ${String(versions.length)} total, v${String(agent.version)} is current.`,
    })}

    <table class="table">
      <thead>
        <tr>
          <th>Version</th>
          <th>Created</th>
          <th>By</th>
          <th>Commit message</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows as unknown as SafeHtml[]}</tbody>
    </table>
  `;

  return render(layout({ title: `${agent.id} versions`, activeNav: 'agents', flash }, body));
}

/**
 * Render a single agent version — the DAG as it was at that point in
 * time, plus a "Rollback to this version" action (disabled on current).
 */
export function renderVersionDetail(args: {
  agent: Agent;
  version: AgentVersion;
}): string {
  const { agent, version } = args;
  const isCurrent = version.version === agent.version;
  const dag = version.dag;

  const nodeRows = dag.nodes.map((n) => {
    const body = n.type === 'shell' ? oneLine(n.command ?? '') : oneLine(n.prompt ?? '');
    const deps = n.dependsOn?.length ? n.dependsOn.join(', ') : html`<span class="dim">\u2014</span>`;
    const typeClass = n.type === 'shell' ? 'badge--ok' : 'badge--info';
    return html`
      <tr>
        <td class="mono">${n.id}</td>
        <td><span class="badge ${typeClass}">${n.type}</span></td>
        <td class="mono">${deps}</td>
        <td class="dim">${body}</td>
      </tr>
    `;
  });

  const headerCta = isCurrent
    ? html`<span class="badge badge--ok">current</span>`
    : html`
        <form method="POST" action="/agents/${agent.id}/rollback" style="margin: 0;">
          <input type="hidden" name="targetVersion" value="${String(version.version)}">
          <button type="submit" class="btn btn--primary"
            onclick="return confirm('Rollback agent \\'${agent.id}\\' to v${String(version.version)}?');">
            Rollback to this version
          </button>
        </form>
      `;

  const body = html`
    ${pageHeader({
      title: `${agent.id} \u2014 v${String(version.version)}`,
      back: { href: `/agents/${agent.id}/versions`, label: `Back to versions` },
      cta: headerCta,
      description: `Created ${formatAge(version.createdAt)} by ${version.createdBy}${version.commitMessage ? ` \u2014 \u201c${version.commitMessage}\u201d` : ''}.`,
    })}

    <section>
      <h2>Nodes at this version</h2>
      <table class="table">
        <thead>
          <tr><th>Id</th><th>Type</th><th>Depends on</th><th>Body</th></tr>
        </thead>
        <tbody>${nodeRows as unknown as SafeHtml[]}</tbody>
      </table>
    </section>

    ${dag.inputs && Object.keys(dag.inputs).length > 0 ? html`
      <section class="mt-6">
        <h2>Inputs</h2>
        <pre>${JSON.stringify(dag.inputs, null, 2)}</pre>
      </section>
    ` : html``}
  `;

  return render(layout({ title: `${agent.id} v${String(version.version)}`, activeNav: 'agents' }, body));
}

function oneLine(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1) + '\u2026';
}
