import {
  evaluatePolicy,
  listBuiltinTools,
  MEMORY_TOOL_IDS,
  type Agent,
  type EnforcedPolicy,
  type ToolStore,
} from '@some-useful-agents/core';
import { html, type SafeHtml } from './html.js';

/**
 * One tool a model may call, as the picker shows it.
 */
export interface PickableTool {
  id: string;
  label: string;
  description: string;
  group: 'tools' | 'agents';
}

/**
 * Everything a goal / llm node's model may call: builtin tools, integration
 * and imported MCP tools, and other agents (`agent:<id>`, active, not this
 * one). Tools that only make sense as a whole node (shell-exec as a flow
 * step is still callable, so it stays) are all included; the synthetic
 * picker entries (llm-prompt, goal) are not tools.
 */
export function listPickableTools(args: { toolStore?: ToolStore; agents?: Agent[]; currentAgentId: string }): PickableTool[] {
  // The memory tools are added automatically when an agent has memory on
  // (and fail otherwise), so they aren't picked by hand.
  const automatic = new Set<string>(MEMORY_TOOL_IDS);
  const out: PickableTool[] = listBuiltinTools().filter((t) => !automatic.has(t.id)).map((t) => ({ id: t.id, label: t.name, description: t.description ?? '', group: 'tools' as const }));
  try {
    for (const t of args.toolStore?.listTools() ?? []) {
      out.push({ id: t.id, label: t.name, description: t.description ?? '', group: 'tools' });
    }
  } catch { /* store unavailable */ }
  for (const a of args.agents ?? []) {
    if (a.id === args.currentAgentId || a.status !== 'active') continue;
    out.push({ id: `agent:${a.id}`, label: a.name, description: a.description ?? `Run the "${a.id}" agent and use its result.`, group: 'agents' });
  }
  return out;
}

/**
 * A searchable checklist of tools for a goal or llm-prompt node: every tool
 * as a checkbox named `name`, grouped Tools / Agents, with what's selected
 * first. Each row says when the project's tool policy blocks the tool for
 * this agent outright. Unknown ids already on the node stay listed (and
 * checked) so an edit never silently drops one.
 */
export function renderToolsMultipicker(args: {
  name: string;
  tools: PickableTool[];
  selected: readonly string[];
  policy?: EnforcedPolicy;
  agent: Pick<Agent, 'id' | 'source'>;
  /** Shown under the heading. */
  hint?: string;
  idPrefix: string;
}): SafeHtml {
  const selected = new Set(args.selected);
  const known = new Set(args.tools.map((t) => t.id));
  const tools: PickableTool[] = [
    ...args.tools,
    ...[...selected].filter((id) => !known.has(id)).map((id) => ({
      id, label: id, description: 'Not installed here (kept on the node).', group: (id.startsWith('agent:') ? 'agents' : 'tools') as PickableTool['group'],
    })),
  ];
  const blockedReason = (id: string): string | undefined => {
    if (!args.policy) return undefined;
    const d = evaluatePolicy(args.policy, { toolId: id, resource: '', agentSource: args.agent.source, agentId: args.agent.id });
    return d.effect === 'deny' ? (d.matchedRuleIndex !== undefined && d.matchedRuleIndex >= 0 ? `Blocked by policy rule #${d.matchedRuleIndex}` : d.reason ?? 'Blocked by policy') : undefined;
  };
  const row = (t: PickableTool) => {
    const blocked = blockedReason(t.id);
    return html`
      <li class="tools-picker__row" data-tools-picker-row data-search="${`${t.id} ${t.label} ${t.description}`.toLowerCase()}">
        <label class="tools-picker__label">
          <input type="checkbox" name="${args.name}" value="${t.id}" ${selected.has(t.id) ? 'checked' : ''}>
          <span class="mono tools-picker__id">${t.id}</span>
          <span class="dim tools-picker__desc">${t.description.split(/(?<=\.)\s/)[0] ?? ''}</span>
          ${blocked ? html`<a class="tools-picker__blocked" target="_blank" rel="noopener"
            href="/settings/policies?tool=${encodeURIComponent(t.id)}&amp;source=${args.agent.source}#check"
            title="See the rule in Settings → Policies (opens a new tab)">${blocked}</a>` : html``}
        </label>
      </li>`;
  };
  const ordered = (group: PickableTool['group']) => {
    const inGroup = tools.filter((t) => t.group === group);
    return [...inGroup.filter((t) => selected.has(t.id)), ...inGroup.filter((t) => !selected.has(t.id))];
  };
  const toolsRows = ordered('tools');
  const agentRows = ordered('agents');
  const searchId = `${args.idPrefix}-tools-search`;
  return html`
    <div class="tools-picker" data-tools-picker>
      ${args.hint ? html`<span class="form-field__hint">${args.hint}</span>` : html``}
      <input type="search" id="${searchId}" class="form-field__input tools-picker__search" placeholder="Search tools and agents…"
        aria-label="Search tools and agents" data-tools-picker-search>
      <p class="dim text-xs tools-picker__count" data-tools-picker-count>${String(selected.size)} selected</p>
      <div class="tools-picker__list">
        <p class="tools-picker__group">Tools</p>
        <ul>${toolsRows.map(row) as unknown as SafeHtml[]}</ul>
        ${agentRows.length > 0 ? html`
          <p class="tools-picker__group">Agents <span class="dim text-xs">— the model can run these as tools (no cycles, 3 levels deep at most)</span></p>
          <ul>${agentRows.map(row) as unknown as SafeHtml[]}</ul>` : html``}
      </div>
    </div>`;
}

/** Selected tool ids from a form body field (checkboxes submit a string or an array). */
export function parseToolsField(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : [];
  return [...new Set(list.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean))];
}
