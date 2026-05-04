/**
 * /nodes page renderer. Browseable catalog of every node type sua
 * exposes. Same data the planner-fronted agent-builder queries via
 * /api/nodes — this page is the human-readable view.
 */

import type { NodeContract, NodeContractField, NodeType } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

interface CategoryDef {
  id: string;
  label: string;
  blurb: string;
  types: NodeType[];
}

// Hardcoded grouping — the catalog itself is flat. Categories are a
// view-layer concern: they help humans browse but the planner still gets
// the unstructured /api/nodes feed.
const CATEGORIES: CategoryDef[] = [
  {
    id: 'execution',
    label: 'Execution',
    blurb: 'Nodes that do work — run a command, call an LLM, write a file.',
    types: ['shell', 'claude-code', 'file-write'],
  },
  {
    id: 'control-flow',
    label: 'Control flow',
    blurb: 'Shape the DAG — branch, gate, loop, compose other agents.',
    types: ['conditional', 'switch', 'loop', 'branch', 'agent-invoke', 'break'],
  },
  {
    id: 'terminal',
    label: 'Terminal',
    blurb: 'Mark the end of a path.',
    types: ['end'],
  },
];

export function renderNodes(opts: { catalog: NodeContract[] }): string {
  const byType = new Map<string, NodeContract>();
  for (const c of opts.catalog) byType.set(c.type, c);

  // Group catalog by category, dropping empties; surface anything not
  // covered by the hardcoded grouping under "Other" so a new node type
  // doesn't silently disappear from the page.
  const grouped = CATEGORIES.map((cat) => ({
    cat,
    contracts: cat.types.map((t) => byType.get(t)).filter((c): c is NodeContract => !!c),
  })).filter((g) => g.contracts.length > 0);
  const covered = new Set(CATEGORIES.flatMap((c) => c.types));
  const orphans = opts.catalog.filter((c) => !covered.has(c.type));
  if (orphans.length > 0) {
    grouped.push({
      cat: { id: 'other', label: 'Other', blurb: 'Uncategorised — add to nodes.ts CATEGORIES to file.', types: [] },
      contracts: orphans,
    });
  }

  const navChips = grouped.map((g) => html`
    <div class="node-nav__group">
      <span class="node-nav__label">${g.cat.label}</span>
      ${g.contracts.map((c) => html`<a href="#${c.type}" class="badge badge--muted node-nav__chip">${c.type}</a>`) as unknown as SafeHtml[]}
    </div>
  `);

  const sections = grouped.map((g) => html`
    <section class="node-cat" id="cat-${g.cat.id}" data-node-cat>
      <header class="node-cat__header">
        <h2 class="node-cat__title">${g.cat.label} <span class="dim node-cat__blurb">— ${g.cat.blurb}</span></h2>
      </header>
      ${g.contracts.map(renderContractCard) as unknown as SafeHtml[]}
    </section>
  `);

  const body = html`
    ${pageHeader({
      title: 'Nodes',
      description:
        'Every first-class node type sua’s executor knows. Hand-authored contracts: what each ' +
        'node takes in, what it emits, when to reach for it. The planner-fronted agent-builder reads ' +
        'this same catalog via /api/nodes when designing new agents.',
    })}

    <div class="node-toolbar">
      <input type="search" id="node-filter" class="node-toolbar__search"
        placeholder="Filter by name, description, or 'use when'..." autocomplete="off">
      <button type="button" class="btn btn--ghost btn--sm" id="node-collapse-all">Collapse all</button>
      <button type="button" class="btn btn--ghost btn--sm" id="node-expand-all">Expand all</button>
      <span class="dim node-toolbar__count" id="node-count">${String(opts.catalog.length)} types</span>
      <a class="dim node-toolbar__api" href="/api/nodes">JSON API</a>
    </div>

    <nav class="node-nav">
      ${navChips as unknown as SafeHtml[]}
    </nav>

    ${sections as unknown as SafeHtml[]}

    <script>
      (function () {
        var input = document.getElementById('node-filter');
        var collapseBtn = document.getElementById('node-collapse-all');
        var expandBtn = document.getElementById('node-expand-all');
        var count = document.getElementById('node-count');
        var cards = Array.prototype.slice.call(document.querySelectorAll('[data-node-search]'));
        var cats = Array.prototype.slice.call(document.querySelectorAll('[data-node-cat]'));
        var total = cards.length;

        function applyFilter() {
          var q = (input.value || '').trim().toLowerCase();
          var visible = 0;
          for (var i = 0; i < cards.length; i++) {
            var hay = cards[i].getAttribute('data-node-search') || '';
            var match = !q || hay.indexOf(q) !== -1;
            cards[i].style.display = match ? '' : 'none';
            if (match) visible++;
          }
          for (var j = 0; j < cats.length; j++) {
            var anyVisible = cats[j].querySelector('[data-node-search]:not([style*="display: none"])');
            cats[j].style.display = anyVisible ? '' : 'none';
          }
          count.textContent = q ? (visible + ' of ' + total + ' types') : (total + ' types');
        }

        function setAllOpen(open) {
          for (var i = 0; i < cards.length; i++) {
            if (open) cards[i].setAttribute('open', '');
            else cards[i].removeAttribute('open');
          }
          try { sessionStorage.setItem('nodes:allOpen', open ? '1' : '0'); } catch (e) {}
        }

        // Persist per-card open state so anchor clicks don't lose what the
        // user has expanded. Listen on toggle (bubbles from <details>).
        document.addEventListener('toggle', function (e) {
          var t = e.target;
          if (!t || !t.matches || !t.matches('.node-card')) return;
          try {
            var key = 'nodes:open:' + t.id;
            if (t.open) sessionStorage.setItem(key, '1');
            else sessionStorage.setItem(key, '0');
          } catch (err) {}
        }, true);

        input.addEventListener('input', applyFilter);
        input.addEventListener('input', function () {
          try { sessionStorage.setItem('nodes:filter', input.value); } catch (e) {}
        });
        collapseBtn.addEventListener('click', function () { setAllOpen(false); });
        expandBtn.addEventListener('click', function () { setAllOpen(true); });

        // Restore filter + per-card open state.
        try {
          var savedQ = sessionStorage.getItem('nodes:filter');
          if (savedQ) { input.value = savedQ; applyFilter(); }
          for (var k = 0; k < cards.length; k++) {
            var saved = sessionStorage.getItem('nodes:open:' + cards[k].id);
            if (saved === '0') cards[k].removeAttribute('open');
            else if (saved === '1') cards[k].setAttribute('open', '');
          }
        } catch (e) { /* sessionStorage may be blocked */ }
      })();
    </script>

    <style>
      .node-toolbar { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; margin: var(--space-3) 0; }
      .node-toolbar__search { flex: 1; min-width: 220px; padding: 6px 10px; font-size: var(--font-size-sm); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); font-family: var(--font-mono); }
      .node-toolbar__compact { font-size: var(--font-size-xs); display: inline-flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }
      .node-toolbar__count, .node-toolbar__api { font-size: var(--font-size-xs); }
      .node-nav { display: flex; flex-direction: column; gap: 4px; margin-bottom: var(--space-4); padding: var(--space-2) var(--space-3); background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
      .node-nav__group { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
      .node-nav__label { font-size: var(--font-size-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; min-width: 6.5rem; font-weight: var(--weight-semibold); }
      .node-nav__chip { font-family: var(--font-mono); text-decoration: none; font-size: 11px; padding: 1px 6px; }
      .node-cat { margin-bottom: var(--space-4); }
      .node-cat__header { margin-bottom: var(--space-2); }
      .node-cat__title { margin: 0; font-size: var(--font-size-sm); font-weight: var(--weight-semibold); text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted); }
      .node-cat__blurb { font-weight: normal; text-transform: none; letter-spacing: normal; font-size: var(--font-size-xs); }
      .node-card { padding: 0; margin-bottom: var(--space-2); }
      .node-card > summary.node-card__header { padding: 6px var(--space-3); margin: 0; cursor: pointer; list-style: none; display: flex; align-items: baseline; gap: var(--space-2); user-select: none; }
      .node-card > summary.node-card__header::-webkit-details-marker { display: none; }
      .node-card > summary.node-card__header:hover { background: var(--color-surface-raised); }
      .node-card__chevron { display: inline-block; width: 0.9em; color: var(--color-text-muted); font-size: 11px; transition: transform 120ms ease; transform: rotate(0deg); flex-shrink: 0; }
      .node-card[open] > summary .node-card__chevron { transform: rotate(90deg); }
      .node-card__type { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-md); flex-shrink: 0; }
      .node-card__desc { color: var(--color-text-muted); line-height: 1.4; font-size: var(--font-size-sm); }
      .node-card__body { margin: 0; padding: var(--space-2) var(--space-3) var(--space-3); border-top: 1px solid var(--color-border); }
      .node-card__grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-3); }
      .node-card__col h4 { font-size: var(--font-size-xs); margin: 0 0 4px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: var(--weight-semibold); }
      .node-card__usewhen { margin-top: var(--space-2); }
      .node-card__usewhen h4 { font-size: var(--font-size-xs); margin: 0 0 4px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: var(--weight-semibold); }
      .node-card__usewhen ul { margin: 0; padding-left: var(--space-4); font-size: var(--font-size-sm); line-height: 1.45; }
      .node-card__example { margin-top: var(--space-2); }
      .node-card__example summary { cursor: pointer; font-size: var(--font-size-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: var(--weight-semibold); }
      .node-card__example pre { margin: 4px 0 0; padding: var(--space-2) var(--space-3); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); overflow-x: auto; font-size: var(--font-size-xs); line-height: 1.4; }
      .node-fields { font-size: var(--font-size-xs); width: 100%; border-collapse: collapse; }
      .node-fields td { padding: 3px 8px 3px 0; vertical-align: top; line-height: 1.4; }
      .node-fields tr + tr td { border-top: 1px solid var(--color-border); }
      .node-fields__name { white-space: nowrap; font-family: var(--font-mono); }
      .node-fields__name .badge { font-size: 9px; padding: 0 4px; margin-left: 4px; }
      .node-fields__type { white-space: nowrap; font-family: var(--font-mono); color: var(--color-text-muted); }
      .node-fields__none { color: var(--color-text-muted); font-size: var(--font-size-xs); margin: 0; }
      /* Each card is a <details> — clicking the header collapses it.
         The "compact" toggle in the toolbar collapses every card at once. */
      @media (max-width: 720px) {
        .node-card__grid { grid-template-columns: 1fr; gap: var(--space-2); }
        .node-nav__label { min-width: 0; width: 100%; }
      }
    </style>
  `;

  return render(layout({ title: 'Nodes', activeNav: 'nodes' }, body));
}

function renderContractCard(c: NodeContract): SafeHtml {
  // Build a haystack string for client-side filtering. Lowercased so the
  // input handler doesn't have to .toLowerCase() per card on every keystroke.
  const hay = [
    c.type,
    c.description,
    ...c.use_when,
    ...c.inputs.map((f) => `${f.name} ${f.description}`),
    ...c.outputs.map((f) => `${f.name} ${f.description}`),
  ].join(' ').toLowerCase();

  return html`
    <details id="${c.type}" class="card node-card" data-node-search="${hay}">
      <summary class="node-card__header">
        <span class="node-card__chevron" aria-hidden="true">▸</span>
        <h3 class="node-card__type">${c.type}</h3>
        <span class="node-card__desc">${c.description}</span>
      </summary>

      <div class="node-card__body">
        <div class="node-card__grid">
          <div class="node-card__col">
            <h4>Inputs</h4>
            ${renderFieldsTable(c.inputs)}
          </div>
          <div class="node-card__col">
            <h4>Outputs</h4>
            ${c.outputs.length === 0
              ? html`<p class="node-fields__none">No result fields.</p>`
              : renderFieldsTable(c.outputs)}
          </div>
        </div>

        <div class="node-card__usewhen">
          <h4>Use when</h4>
          <ul>
            ${c.use_when.map((line) => html`<li>${line}</li>`) as unknown as SafeHtml[]}
          </ul>
        </div>

        <details class="node-card__example">
          <summary>Example</summary>
          <pre><code>${c.example}</code></pre>
        </details>
      </div>
    </details>
  `;
}

function renderFieldsTable(fields: NodeContractField[]): SafeHtml {
  if (fields.length === 0) {
    return html`<p class="node-fields__none">None.</p>`;
  }
  return html`
    <table class="node-fields">
      <tbody>
        ${fields.map((f) => html`
          <tr>
            <td class="node-fields__name">
              ${f.name}${f.required ? html`<span class="badge badge--ok">req</span>` : html``}
            </td>
            <td class="node-fields__type">${f.type}</td>
            <td>${f.description}</td>
          </tr>
        `) as unknown as SafeHtml[]}
      </tbody>
    </table>
  `;
}
