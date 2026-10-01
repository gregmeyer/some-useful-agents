import {
  prepareViewForRender,
  resolveAgentView,
  viewToMessages,
  type Agent,
  type NodeExecutionRecord,
  type Run,
} from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from '../views/html.js';

/**
 * The page markup for one A2UI surface: a host element carrying the A2UI
 * messages as JSON, drawn in the browser by /assets/a2ui-sua.js. `<` is
 * escaped inside the JSON so nothing in a view can close the script tag.
 */
export function renderSurfaceHost(surfaceId: string, messages: unknown[], opts: { label?: string } = {}): SafeHtml {
  const json = JSON.stringify(messages).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return html`<div class="a2ui-host" data-a2ui-surface data-surface-id="${surfaceId}" aria-label="${opts.label ?? 'Widget'}"><script type="application/json">${unsafeHtml(json)}</script></div>`;
}

/**
 * An agent's view for one run, as markup: the surface when the view is valid,
 * a short note when a generated view wasn't (model output is never shown
 * raw), nothing when the agent has no view.
 */
export function renderRunView(
  agent: Pick<Agent, 'id' | 'view' | 'permissions'>,
  run: Run,
  nodeExecutions: readonly NodeExecutionRecord[],
  surfaceId = `run-${run.id}`,
): SafeHtml {
  const resolved = resolveAgentView(agent, { run, nodeExecutions });
  if (!resolved) return html``;
  if (!resolved.ok) {
    return html`<div class="a2ui-host a2ui-host--error"><span class="dim">This reply's widget couldn't be shown:</span> ${resolved.errors[0] ?? 'invalid view'}</div>`;
  }
  const components = prepareViewForRender(resolved.components, resolved.dataModel);
  return renderSurfaceHost(surfaceId, viewToMessages(surfaceId, components, resolved.dataModel), { label: `${agent.id} widget` });
}
