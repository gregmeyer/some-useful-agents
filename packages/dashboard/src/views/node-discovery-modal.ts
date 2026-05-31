/**
 * Node-discovery modal for the add-node form.
 *
 * Surfaces every available node primitive in one searchable picklist:
 *   - Quick patterns (NODE_PATTERNS) — pre-set defaults for common shapes
 *   - Built-in tools (listBuiltinTools) — shell-exec, http-get, etc.
 *   - User tools (toolStore.listTools) — operator-defined wrappers
 *   - Agents (agentStore.listAgents, minus self) — invocable as sub-nodes
 *
 * Mirrors the Add Tile / Allowed Sub-Agents picklist UX: card grid +
 * search input + click-to-select. Renders alongside the existing
 * "Quick start patterns" strip so an operator can still one-click the
 * top 5 patterns without opening the modal.
 *
 * Picking a card runs the same dropdown-mutation the existing
 * pattern-strip buttons use (sets `#node-tool-select`, dispatches
 * change, optionally pre-fills toolInput_* fields), then closes the
 * modal. JS lives in `node-discovery.js.ts`.
 */

import type { Agent, ToolDefinition } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';
import { NODE_PATTERNS, type NodePattern } from './node-patterns.js';

/** A unified card descriptor for the picklist. */
export interface DiscoveryEntry {
  /** Stable id used by the JS to set the dropdown value. */
  toolId: string;
  /** Operator-facing label. */
  name: string;
  /** One-line description. */
  description: string;
  /** Group bucket — drives the section heading. */
  group: 'pattern' | 'builtin' | 'user' | 'agent';
  /** Optional pre-fill values for `toolInput_<name>` fields. */
  defaults?: Record<string, string>;
}

export interface NodeDiscoveryModalOptions {
  /** Built-in + user tools from getAvailableTools(). */
  tools: ToolDefinition[];
  /** Other agents that can be invoked as sub-nodes (current excluded by caller). */
  agents: Agent[];
}

const GROUP_LABEL: Record<DiscoveryEntry['group'], string> = {
  pattern: 'Quick patterns',
  builtin: 'Built-in tools',
  user: 'User tools',
  agent: 'Invocable agents',
};

const GROUP_ORDER: DiscoveryEntry['group'][] = ['pattern', 'builtin', 'user', 'agent'];

function patternEntry(p: NodePattern): DiscoveryEntry {
  return {
    toolId: p.tool,
    name: p.name,
    description: p.description,
    group: 'pattern',
    defaults: p.defaults,
  };
}

function toolEntry(t: ToolDefinition): DiscoveryEntry {
  // shell-exec and the synthetic `llm-prompt` entry are always available
  // and live alongside other built-ins in the modal.
  return {
    toolId: t.id,
    name: t.name,
    description: t.description ?? '',
    group: t.source === 'builtin' ? 'builtin' : 'user',
  };
}

function agentEntry(a: Agent): DiscoveryEntry {
  const inputCount = Object.keys(a.inputs ?? {}).length;
  return {
    toolId: `agent:${a.id}`,
    name: a.name,
    description: (a.description ?? '').trim() || `Invoke agent "${a.id}" as a sub-node${inputCount > 0 ? ` (${inputCount} inputs)` : ''}`,
    group: 'agent',
  };
}

export function buildDiscoveryEntries(opts: NodeDiscoveryModalOptions): DiscoveryEntry[] {
  const out: DiscoveryEntry[] = [];
  for (const p of NODE_PATTERNS) out.push(patternEntry(p));
  for (const t of opts.tools) out.push(toolEntry(t));
  for (const a of opts.agents) out.push(agentEntry(a));
  return out;
}

export function renderNodeDiscoveryButton(): SafeHtml {
  return html`
    <button type="button" class="btn btn--sm" data-node-discovery-open>Discover nodes…</button>
  `;
}

export function renderNodeDiscoveryModal(opts: NodeDiscoveryModalOptions): SafeHtml {
  const entries = buildDiscoveryEntries(opts);
  const payload = JSON.stringify(entries).replace(/</g, '\\u003c');

  // Group entries for server-side initial render. JS reuses the
  // payload script to re-render filtered results on search.
  const grouped: Record<DiscoveryEntry['group'], DiscoveryEntry[]> = {
    pattern: [],
    builtin: [],
    user: [],
    agent: [],
  };
  for (const e of entries) grouped[e.group].push(e);

  const groupSections = GROUP_ORDER
    .filter((g) => grouped[g].length > 0)
    .map((g) => html`
      <div class="node-discovery__group" data-group="${g}">
        <h4 class="node-discovery__group-label">${GROUP_LABEL[g]} <span class="dim">(${String(grouped[g].length)})</span></h4>
        <div class="node-discovery__grid">
          ${grouped[g].map((e) => renderCard(e)) as unknown as SafeHtml[]}
        </div>
      </div>
    `);

  return html`
    <div id="node-discovery-modal" class="modal-backdrop" hidden>
      <div class="modal node-discovery__modal" role="dialog" aria-label="Discover nodes">
        <div class="node-discovery__header">
          <h3 style="margin: 0;">Discover nodes</h3>
          <button type="button" class="btn btn--ghost btn--sm" data-node-discovery-close aria-label="Close">×</button>
        </div>
        <input type="search" id="node-discovery-search" class="input node-discovery__search"
          placeholder="Search patterns, tools, agents…" autocomplete="off">
        <div class="node-discovery__body" id="node-discovery-body">
          ${groupSections as unknown as SafeHtml[]}
          <p class="node-discovery__empty dim" id="node-discovery-empty" hidden>No matches.</p>
        </div>
      </div>
      ${unsafeHtml(`<script type="application/json" id="node-discovery-payload">${payload}</script>`)}
    </div>
  `;
}

function renderCard(e: DiscoveryEntry): SafeHtml {
  const defaults = e.defaults ? unsafeHtml(JSON.stringify(e.defaults).replace(/"/g, '&quot;')) : unsafeHtml('');
  return html`
    <button type="button" class="node-discovery__card"
      data-node-discovery-pick="${e.toolId}"
      data-node-discovery-group="${e.group}"
      ${e.defaults ? html`data-node-discovery-defaults="${defaults}"` : html``}>
      <div class="node-discovery__card-head">
        <span class="node-discovery__card-name">${e.name}</span>
        <span class="node-discovery__card-chip">${GROUP_LABEL[e.group]}</span>
      </div>
      ${e.description ? html`<div class="node-discovery__card-desc">${e.description}</div>` : html``}
      <div class="node-discovery__card-id mono dim">${e.toolId}</div>
    </button>
  `;
}
