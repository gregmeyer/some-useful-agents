import {
  validateViewComponents,
  prepareViewForRender,
  resolveAgentView,
  viewToMessages,
  VIEW_SERIES_MAX,
  type Agent,
  type RunStore,
  type NodeExecutionRecord,
  type Run,
  type ViewComponent,
} from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from '../views/html.js';
import type { LegacyView } from './legacy-view.js';
import type { OutputWidgetSchema } from '@some-useful-agents/core';
import { renderCopyControl } from '../views/output-widgets.js';

/**
 * The page markup for one A2UI surface: a host element carrying the A2UI
 * messages as JSON, drawn in the browser by /assets/a2ui-sua.js. `<` is
 * escaped inside the JSON so nothing in a view can close the script tag.
 */
export function renderSurfaceHost(surfaceId: string, messages: unknown[], opts: { label?: string; agentId?: string } = {}): SafeHtml {
  const json = JSON.stringify(messages).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const agentAttr = opts.agentId ? html` data-view-agent="${opts.agentId}"` : html``;
  return html`<div class="a2ui-host" data-a2ui-surface data-surface-id="${surfaceId}"${agentAttr} aria-label="${opts.label ?? 'Widget'}"><script type="application/json">${unsafeHtml(json)}</script></div>`;
}

/** Where a view's earlier runs come from; `runStore` reads them, or pass `history` directly. */
export interface RunViewOptions {
  runStore?: Pick<RunStore, 'queryRuns' | 'listNodeExecutions'>;
  history?: Parameters<typeof resolveAgentView>[1]['history'];
}

/**
 * The agent's completed runs before `run`, newest first, for `/history` and
 * `/series`. Only read when the view could use them: a declared view that
 * mentions /history or /series, or any generated view (its bindings aren't
 * known until it's resolved).
 */
export function viewHistory(
  agent: Pick<Agent, 'id' | 'view'>,
  run: Run,
  runStore: RunViewOptions['runStore'],
): NonNullable<RunViewOptions['history']> {
  if (!runStore || !agent.view) return [];
  if ('components' in agent.view && !/"\/(history|series)\b/.test(JSON.stringify(agent.view.components))) return [];
  try {
    const { rows } = runStore.queryRuns({ agentName: agent.id, statuses: ['completed'], until: run.startedAt, limit: VIEW_SERIES_MAX - 1 });
    return rows.filter((r) => r.id !== run.id).map((r) => ({ run: r, nodeExecutions: runStore.listNodeExecutions(r.id) }));
  } catch {
    return [];
  }
}

/** A Run button in an agent's view always runs that agent (whatever the view, or a model that wrote it, says). */
function pinRunActions(components: ViewComponent[], agentId: string): ViewComponent[] {
  return components.map((c) => {
    const event = (c as { action?: { event?: { name?: unknown; context?: Record<string, unknown> } } }).action?.event;
    if (!event || event.name !== 'run-agent') return c;
    return { ...c, action: { ...(c as unknown as { action: object }).action, event: { ...event, context: { ...(event.context ?? {}), agent: agentId } } } } as unknown as ViewComponent;
  });
}

/**
 * An agent's view for one run, as markup: the surface when the view is valid,
 * a short note when a generated view wasn't (model output is never shown
 * raw), nothing when the agent has no view.
 */
export function renderRunView(
  agent: Pick<Agent, 'id' | 'view' | 'permissions'> & { name?: string },
  run: Run,
  nodeExecutions: readonly NodeExecutionRecord[],
  surfaceId = `run-${run.id}`,
  opts: RunViewOptions = {},
): SafeHtml {
  const out = runViewMessages(agent, run, nodeExecutions, surfaceId, opts);
  if (!out) return html``;
  if ('error' in out) {
    return html`<div class="a2ui-host a2ui-host--error"><span class="dim">This reply's widget couldn't be shown:</span> ${out.error}</div>`;
  }
  return renderSurfaceHost(surfaceId, out.messages, { label: `${agent.id} widget`, agentId: agent.id });
}

/** An agent's view for one run as A2UI messages; `error` when a generated view didn't validate; undefined with no view. */
export function runViewMessages(
  agent: Pick<Agent, 'id' | 'view' | 'permissions'> & { name?: string },
  run: Run,
  nodeExecutions: readonly NodeExecutionRecord[],
  surfaceId = `run-${run.id}`,
  opts: RunViewOptions = {},
): { messages: unknown[] } | { error: string } | undefined {
  if (!agent.view) return undefined;
  const history = opts.history ?? viewHistory(agent, run, opts.runStore);
  const resolved = resolveAgentView(agent, { run, nodeExecutions, history, agent: { id: agent.id, ...(agent.name ? { name: agent.name } : {}) } });
  if (!resolved) return undefined;
  if (!resolved.ok) return { error: resolved.errors[0] ?? 'invalid view' };
  const components = pinRunActions(prepareViewForRender(resolved.components, resolved.dataModel), agent.id);
  return { messages: viewToMessages(surfaceId, components, resolved.dataModel) };
}

/**
 * A converted pre-A2UI widget (lib/legacy-view.ts) as a surface, or undefined
 * when it can't be drawn that way (unsupported, or, defensively, a conversion
 * that doesn't validate), so the caller keeps the old renderer.
 */
export function renderLegacySurface(surfaceId: string, legacy: LegacyView, opts: { widget?: OutputWidgetSchema } = {}): SafeHtml | undefined {
  const messages = legacySurfaceMessages(surfaceId, legacy);
  if (!messages) return undefined;
  const surface = renderSurfaceHost(surfaceId, messages, { label: 'Widget' });
  // A widget's copy control: the same button, in the same row-before-body
  // shape views/widget-copy.js.ts looks for.
  const copy = (opts.widget?.controls ?? []).find((c): c is Extract<typeof c, { type: 'copy' }> => c.type === 'copy');
  return copy ? html`<div class="wc-row" data-widget-control-row="">${renderCopyControl(copy)}</div>${surface}` : surface;
}

/** A converted pre-A2UI widget as A2UI messages, or undefined when it can't be drawn that way. */
export function legacySurfaceMessages(surfaceId: string, legacy: LegacyView): unknown[] | undefined {
  if ('unsupported' in legacy) return undefined;
  const v = validateViewComponents(legacy.components);
  if (!v.ok) return undefined;
  const dataModel = { data: legacy.data };
  return viewToMessages(surfaceId, prepareViewForRender(v.components, dataModel), dataModel);
}
