/**
 * The View editor (/agents/:name/view): an agent's A2UI view as YAML, checked
 * and previewed against its last completed run, and saved as a new version.
 * See docs/a2ui-views.md.
 */
import { Document, parse as parseYaml } from 'yaml';
import {
  buildViewDataModel,
  runOutputs,
  starterView,
  validateViewComponents,
  type Agent,
  type NodeExecutionRecord,
  type Run,
  type RunStore,
  type ViewComponent,
} from '@some-useful-agents/core';
import { renderRunView, viewHistory } from './a2ui-surface.js';
import { html, type SafeHtml } from '../views/html.js';

export interface ViewSample {
  run: Run;
  nodeExecutions: NodeExecutionRecord[];
  history: NonNullable<Parameters<typeof buildViewDataModel>[0]['history']>;
}

/** The agent's last completed run (and the runs before it), to preview a view with. */
export function viewSample(agent: Pick<Agent, 'id'>, runStore: Pick<RunStore, 'queryRuns' | 'listNodeExecutions'>): ViewSample | undefined {
  try {
    const run = runStore.queryRuns({ agentName: agent.id, statuses: ['completed'], limit: 1 }).rows[0];
    if (!run) return undefined;
    // Always read the history here: the view being typed may start binding /series.
    const history = viewHistory({ id: agent.id, view: { from: '_' } }, run, runStore);
    return { run, nodeExecutions: runStore.listNodeExecutions(run.id), history };
  } catch {
    return undefined;
  }
}

/** Components as YAML, one component per line (the shape docs/a2ui-views.md uses). */
export function viewToYaml(components: readonly ViewComponent[]): string {
  const doc = new Document(components);
  const seq = doc.contents as { items?: Array<{ flow?: boolean }> } | null;
  for (const item of seq?.items ?? []) item.flow = true;
  return doc.toString({ lineWidth: 0 });
}

/** Parse the editor's text: a list of components, or `{ components: [...] }`. */
export function parseViewText(text: string, imgHosts: string[] = []): { components: ViewComponent[] } | { errors: string[] } {
  if (!text.trim()) return { errors: ['The view is empty. Add components, or use Start from its outputs.'] };
  let parsed: unknown;
  try { parsed = parseYaml(text); } catch (err) {
    return { errors: [`Not valid YAML: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`] };
  }
  const list = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { components?: unknown }).components) ? (parsed as { components: unknown[] }).components
    : undefined;
  if (!list) return { errors: ['Expected a list of components (each a line starting with "- { id: … }").'] };
  const v = validateViewComponents(list, { imgHosts });
  return v.ok ? { components: v.components } : { errors: v.errors.map(plainError) };
}

/** The validator's wording, minus catalog URLs. */
function plainError(e: string): string {
  const unknown = /Unknown component type '([^']+)' not found in catalog/.exec(e);
  return unknown ? `"${unknown[1]}" isn't a component sua knows. The list is under sua components, below.` : e;
}

/** The starting view the editor offers: built from what the last run output, labelled by the old widget's fields. */
export function editorStarterView(agent: Pick<Agent, 'outputWidget'>, sample: ViewSample | undefined): ViewComponent[] {
  const outputs = sample ? runOutputs(sample.run, sample.nodeExecutions) : {};
  const series = sample ? buildViewDataModel({ run: sample.run, nodeExecutions: sample.nodeExecutions, history: sample.history }).series : {};
  const labels: Record<string, string> = {};
  for (const f of agent.outputWidget?.fields ?? []) if (f.label) labels[f.name] = f.label;
  return starterView({ outputs, series, labels });
}

/** The preview: the components drawn with the sample run, or a note when there's no run yet. */
export function renderViewPreview(
  agent: Pick<Agent, 'id' | 'name' | 'permissions'>,
  components: ViewComponent[],
  sample: ViewSample | undefined,
  surfaceId = 'view-preview',
): SafeHtml {
  if (!sample) return html`<p class="dim view-editor__note">Run the agent once to preview its view with real data.</p>`;
  return renderRunView({ ...agent, view: { components } }, sample.run, sample.nodeExecutions, surfaceId, { history: sample.history });
}

/** Paths a view can bind to, with this run's values, for the editor's reference list. */
export function bindablePaths(sample: ViewSample | undefined): Array<{ path: string; example: string }> {
  if (!sample) return [{ path: '/result', example: 'the run\'s result text' }];
  const model = buildViewDataModel({ run: sample.run, nodeExecutions: sample.nodeExecutions, history: sample.history });
  const show = (v: unknown) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  };
  const out: Array<{ path: string; example: string }> = [];
  for (const [k, v] of Object.entries(model.outputs)) out.push({ path: `/outputs/${k}`, example: show(v) });
  for (const [k, v] of Object.entries(model.series)) out.push({ path: `/series/${k}`, example: `${String(v.length)} point${v.length === 1 ? '' : 's'}: ${show(v.slice(-5))}` });
  for (const [k, v] of Object.entries(model.inputs)) out.push({ path: `/inputs/${k}`, example: show(v) });
  out.push({ path: '/result', example: show(model.result) });
  out.push({ path: '/history', example: `${String(model.history.length)} earlier run${model.history.length === 1 ? '' : 's'}` });
  out.push({ path: '/run/completedAt', example: model.run.completedAt ?? '' });
  return out;
}
