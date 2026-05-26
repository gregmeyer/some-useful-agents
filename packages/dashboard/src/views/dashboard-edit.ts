/**
 * Editor for a stored dashboard at /dashboards/:id/edit.
 *
 * Server-rendered, no JS. Every action (add/remove/move/rename) is a
 * tiny form POST that 303s back to /edit. Drag-drop is intentionally
 * deferred to a follow-up; up/down arrows are easier to test and
 * harder to misuse than client-side reorder.
 *
 * The Default Dashboard backing /pulse is auto-derived from
 * pulseVisible and has no row in the dashboards table, so it's
 * non-editable here by construction. Pack-owned and user-created
 * dashboards both editable; renaming a pack-owned dashboard or
 * removing tiles is fine — the changes persist independent of
 * whether the pack is reinstalled later.
 */

import type { Agent, Dashboard } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

export interface RenderDashboardEditInput {
  dashboard: Dashboard;
  /**
   * Agents available to add to sections. Filtered to those with a
   * `signal` block (only signal-bearing agents render as Pulse tiles).
   */
  signalAgents: Agent[];
  flash?: { kind: 'ok' | 'error' | 'info'; message: string };
}

export function renderDashboardEditPage(input: RenderDashboardEditInput): string {
  const d = input.dashboard;
  const sections = d.layout.sections;

  const body = html`
    ${pageHeader({
      title: `Edit · ${d.name}`,
      back: { href: `/dashboards/${encodeURIComponent(d.id)}`, label: 'Done editing' },
      description: d.packId
        ? `Pack-owned (${d.packId}) · id ${d.id}. Renaming keeps this id, so pack uninstall still matches. Edits persist; reinstalling the pack would reset to the manifest's layout.`
        : `User-created dashboard · id ${d.id}. Renaming keeps this id.`,
    })}

    <div style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-4); flex-wrap: wrap;">
      <form method="POST" action="/dashboards/${encodeURIComponent(d.id)}/rename" style="display: flex; gap: var(--space-1); margin: 0;">
        <input type="text" name="name" value="${d.name}" required aria-label="Dashboard name" style="padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); font-weight: var(--weight-semibold); min-width: 16rem;">
        <button type="submit" class="btn btn--ghost">Rename</button>
      </form>
      <a class="btn btn--ghost" href="/dashboards/${encodeURIComponent(d.id)}">View</a>
      ${d.packId === null ? html`
        <form method="POST" action="/dashboards/${encodeURIComponent(d.id)}/delete" style="margin: 0; display: inline;" onsubmit="return confirm('Delete this dashboard? This cannot be undone.');">
          <button type="submit" class="btn btn--ghost">Delete dashboard</button>
        </form>
      ` : html`
        <a class="btn btn--ghost" href="/packs/${encodeURIComponent(d.packId)}">Manage pack →</a>
      `}
    </div>

    ${d.packId !== null ? html`
      <p class="dim" style="margin: 0 0 var(--space-4) 0; font-size: var(--font-size-sm);">
        This dashboard is owned by the <span class="mono">${d.packId}</span> pack, so it can't be deleted here — deleting it would just reappear when the pack reloads. To remove it, uninstall the pack from its
        <a href="/packs/${encodeURIComponent(d.packId)}">pack page</a> (that removes the pack's dashboards but keeps any agents it contributed).
      </p>
    ` : html``}

    ${sections.length === 0 ? html`<p class="dim" style="padding: var(--space-3) 0;">No sections yet. Add one below to get started.</p>` : html``}

    ${sections.map((s, idx) => renderSectionEditor(d, s, idx, sections.length, input.signalAgents)) as unknown as SafeHtml[]}

    <section class="card" style="margin-top: var(--space-4); padding: var(--space-3);">
      <h3 style="margin: 0 0 var(--space-2) 0; font-size: var(--font-size-md);">Add a section</h3>
      <form method="POST" action="/dashboards/${encodeURIComponent(d.id)}/sections" style="display: flex; gap: var(--space-2);">
        <input type="text" name="title" placeholder="Section title" required style="flex: 1; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);">
        <button type="submit" class="btn btn--primary">Add</button>
      </form>
    </section>
  `;

  return render(layout({
    title: `Edit ${d.name}`,
    activeNav: 'pulse',
    flash: input.flash,
  }, body));
}

function renderSectionEditor(
  d: Dashboard,
  section: { title: string; agentIds: string[] },
  idx: number,
  total: number,
  signalAgents: Agent[],
): SafeHtml {
  const isFirst = idx === 0;
  const isLast = idx === total - 1;
  const dashId = encodeURIComponent(d.id);

  // Agents already in this section are removed from the add-tile dropdown.
  const inSection = new Set(section.agentIds);
  const addable = signalAgents.filter((a) => !inSection.has(a.id));

  return html`
    <section class="card" style="margin-bottom: var(--space-3); padding: var(--space-3);">
      <div style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3);">
        <form method="POST" action="/dashboards/${dashId}/sections/${String(idx)}/rename" style="display: flex; gap: var(--space-1); flex: 1;">
          <input type="text" name="title" value="${section.title}" required style="flex: 1; padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); font-weight: var(--weight-semibold);">
          <button type="submit" class="btn btn--ghost btn--sm">Rename</button>
        </form>
        <form method="POST" action="/dashboards/${dashId}/sections/${String(idx)}/move?dir=up" style="margin: 0;">
          <button type="submit" class="btn btn--ghost btn--sm" ${isFirst ? 'disabled' : ''} title="Move section up">↑</button>
        </form>
        <form method="POST" action="/dashboards/${dashId}/sections/${String(idx)}/move?dir=down" style="margin: 0;">
          <button type="submit" class="btn btn--ghost btn--sm" ${isLast ? 'disabled' : ''} title="Move section down">↓</button>
        </form>
        <form method="POST" action="/dashboards/${dashId}/sections/${String(idx)}/delete" style="margin: 0;" onsubmit="return confirm('Remove this section and all its tiles?');">
          <button type="submit" class="btn btn--ghost btn--sm" title="Remove section">×</button>
        </form>
      </div>

      ${section.agentIds.length === 0
        ? html`<p class="dim" style="font-size: var(--font-size-sm); margin: 0 0 var(--space-2) 0;">No tiles in this section yet.</p>`
        : html`
          <ul style="list-style: none; padding: 0; margin: 0 0 var(--space-2) 0; display: flex; flex-direction: column; gap: var(--space-1);">
            ${section.agentIds.map((agentId, tileIdx) => html`
              <li style="display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); background: var(--color-surface-raised); border-radius: var(--radius-sm);">
                <code style="flex: 1; font-size: var(--font-size-sm);">${agentId}</code>
                <form method="POST" action="/dashboards/${dashId}/sections/${String(idx)}/tiles/${String(tileIdx)}/move?dir=up" style="margin: 0;">
                  <button type="submit" class="btn btn--ghost btn--sm" ${tileIdx === 0 ? 'disabled' : ''} title="Move tile up">↑</button>
                </form>
                <form method="POST" action="/dashboards/${dashId}/sections/${String(idx)}/tiles/${String(tileIdx)}/move?dir=down" style="margin: 0;">
                  <button type="submit" class="btn btn--ghost btn--sm" ${tileIdx === section.agentIds.length - 1 ? 'disabled' : ''} title="Move tile down">↓</button>
                </form>
                <form method="POST" action="/dashboards/${dashId}/sections/${String(idx)}/tiles/${String(tileIdx)}/delete" style="margin: 0;">
                  <button type="submit" class="btn btn--ghost btn--sm" title="Remove tile">×</button>
                </form>
              </li>
            `) as unknown as SafeHtml[]}
          </ul>
        `}

      ${addable.length > 0 ? html`
        <form method="POST" action="/dashboards/${dashId}/sections/${String(idx)}/tiles" style="display: flex; gap: var(--space-2); margin-top: var(--space-2);">
          <select name="agentId" required style="flex: 1; padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);">
            <option value="">Add an agent…</option>
            ${addable.map((a) => html`<option value="${a.id}">${a.name} (${a.id})</option>`) as unknown as SafeHtml[]}
          </select>
          <button type="submit" class="btn btn--ghost btn--sm">Add tile</button>
        </form>
      ` : html`<p class="dim" style="font-size: var(--font-size-xs); margin: var(--space-2) 0 0 0;">All available agents are already in this section.</p>`}
    </section>
  `;
}
