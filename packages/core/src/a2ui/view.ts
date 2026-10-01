/**
 * A2UI views for agents (docs/a2ui-views.md, ADR-0047).
 *
 * An agent's `view:` is either DECLARED (an A2UI v0.9 component list in the
 * YAML, bound to data each run fills in) or GENERATED (`from: <nodeId>`: that
 * node's output is the component list, so the widget's shape can change from
 * run to run). Both go through one strict validator: the A2UI message
 * processor itself, in strict mode, against the sua catalog (the same code the
 * browser renderer runs), plus sua's own limits.
 */
import { MessageProcessor, STRICT_VALIDATION } from '@a2ui/web_core/v0_9';
import type { Run } from '../types.js';
import type { NodeExecutionRecord } from '../agent-v2-types.js';
import { A2UI_PROTOCOL_VERSION, SUA_CATALOG_ID, suaCatalog } from './catalog.js';
import { sanitizeHtml } from '../html-sanitizer.js';

export const MAX_VIEW_COMPONENTS = 200;
export const MAX_VIEW_BYTES = 64 * 1024;

export type ViewComponent = Record<string, unknown> & { id: string; component: string };

export type AgentView =
  | { components: ViewComponent[] }
  | { from: string };

export interface ViewValidationOptions {
  /** Hosts images may load from (the agent's `permissions.imgSrc`; `*.example.com` allowed). */
  imgHosts?: readonly string[];
}

export type ViewValidation = { ok: true; components: ViewComponent[] } | { ok: false; errors: string[] };

function hostAllowed(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((p) => {
    const q = p.toLowerCase();
    return q.startsWith('*.') ? h.endsWith(q.slice(1)) && h !== q.slice(2) : h === q;
  });
}

/** Checks the processor can't make: literal image hosts and link schemes. Bound values are checked at render time. */
function staticChecks(components: ViewComponent[], opts: ViewValidationOptions): string[] {
  const errors: string[] = [];
  for (const c of components) {
    if (c.component === 'Image' && typeof c.url === 'string') {
      let url: URL | undefined;
      try { url = new URL(c.url); } catch { errors.push(`${c.id}: Image url "${c.url}" isn't a valid URL.`); continue; }
      if (url.protocol === 'data:') continue;
      if (url.protocol !== 'https:') errors.push(`${c.id}: Image url must be https.`);
      else if (!hostAllowed(url.hostname, opts.imgHosts ?? [])) {
        errors.push(`${c.id}: images from ${url.hostname} aren't allowed; add it to permissions.imgSrc.`);
      }
    }
    if (c.component === 'Link' && typeof c.url === 'string' && !/^(https?:\/\/|\/(?!\/))/i.test(c.url)) {
      errors.push(`${c.id}: Link url must start with http://, https:// or / (a dashboard path).`);
    }
  }
  return errors;
}

/**
 * Validate a component list: shape and limits, then the A2UI processor in
 * strict mode (known components only, every prop checked against its schema,
 * exactly one `root`, no dangling or unreachable components, bounded depth),
 * then sua's static checks. Errors are short, one per problem.
 */
export function validateViewComponents(input: unknown, opts: ViewValidationOptions = {}): ViewValidation {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, errors: ['A view needs a non-empty list of components.'] };
  if (input.length > MAX_VIEW_COMPONENTS) return { ok: false, errors: [`A view can have at most ${MAX_VIEW_COMPONENTS} components (got ${input.length}).`] };
  const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
  if (bytes > MAX_VIEW_BYTES) return { ok: false, errors: [`A view can be at most ${MAX_VIEW_BYTES / 1024} KB (got ${Math.ceil(bytes / 1024)} KB).`] };
  const errors: string[] = [];
  input.forEach((c, i) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) errors.push(`components[${i}] must be an object.`);
    else if (typeof (c as { id?: unknown }).id !== 'string' || !(c as { id: string }).id) errors.push(`components[${i}] needs an id.`);
    else if (typeof (c as { component?: unknown }).component !== 'string') errors.push(`${(c as { id: string }).id}: needs a component type.`);
  });
  if (errors.length) return { ok: false, errors };
  const components = input as ViewComponent[];
  const processor = new MessageProcessor([suaCatalog()], undefined, { validationConfig: STRICT_VALIDATION });
  try {
    processor.processMessages([
      { version: A2UI_PROTOCOL_VERSION, createSurface: { surfaceId: 'validate', catalogId: SUA_CATALOG_ID } },
      { version: A2UI_PROTOCOL_VERSION, updateComponents: { surfaceId: 'validate', components } },
    ] as never);
  } catch (err) {
    return { ok: false, errors: [String((err as Error).message ?? err).split('\n')[0].slice(0, 400)] };
  }
  const more = staticChecks(components, opts);
  return more.length ? { ok: false, errors: more } : { ok: true, components };
}

/**
 * Pull a generated view out of a node's output: `<a2ui>…</a2ui>` first, then a
 * ```json fence, then the whole text. The JSON may be the component list, or
 * `{ components, data? }` where `data` is extra data the view binds to at `/data`.
 */
export function extractGeneratedView(text: string): { components: unknown; data?: unknown } | undefined {
  const tagged = /<a2ui>([\s\S]*?)<\/a2ui>/i.exec(text);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [tagged?.[1], fenced?.[1], text].filter((s): s is string => typeof s === 'string');
  for (const raw of candidates) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw.trim()); } catch { continue; }
    if (Array.isArray(parsed)) return { components: parsed };
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { components?: unknown }).components)) {
      const p = parsed as { components: unknown; data?: unknown };
      return { components: p.components, ...(p.data !== undefined ? { data: p.data } : {}) };
    }
  }
  return undefined;
}

export interface ViewDataModel {
  /** The agent's outputs from this run (last completed node's structured outputs, or the result parsed as JSON). */
  outputs: Record<string, unknown>;
  /** The run's result text. */
  result: string;
  inputs: Record<string, string>;
  run: { id: string; status: string; startedAt: string; completedAt?: string; durationMs?: number; costUsd?: number };
  /** Earlier runs, newest first (for sparklines): their outputs and when they ended. */
  history: Array<{ outputs: Record<string, unknown>; completedAt?: string }>;
  /** Extra data a generated view brought with it. */
  data?: unknown;
}

function parseObject(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

/** The outputs a view binds to at `/outputs`. */
export function runOutputs(run: Pick<Run, 'result'>, nodeExecutions: readonly NodeExecutionRecord[]): Record<string, unknown> {
  const completed = nodeExecutions.filter((e) => e.status === 'completed');
  for (let i = completed.length - 1; i >= 0; i--) {
    const o = parseObject(completed[i].outputsJson);
    if (o && Object.keys(o).length > 0) return o;
  }
  return parseObject(run.result) ?? {};
}

/** The data model a view binds to, built from a run (and, for sparklines, earlier runs). */
export function buildViewDataModel(args: {
  run: Run;
  nodeExecutions: readonly NodeExecutionRecord[];
  inputs?: Record<string, string>;
  history?: ReadonlyArray<{ run: Run; nodeExecutions: readonly NodeExecutionRecord[] }>;
}): ViewDataModel {
  const { run } = args;
  const durationMs = run.completedAt ? Date.parse(run.completedAt) - Date.parse(run.startedAt) : undefined;
  return {
    outputs: runOutputs(run, args.nodeExecutions),
    result: run.result ?? '',
    inputs: { ...(run.resumeContext?.inputs ?? {}), ...(args.inputs ?? {}) },
    run: {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      ...(run.completedAt ? { completedAt: run.completedAt } : {}),
      ...(durationMs !== undefined && Number.isFinite(durationMs) ? { durationMs } : {}),
      ...(run.usage?.costUsd !== undefined ? { costUsd: run.usage.costUsd } : {}),
    },
    history: (args.history ?? []).map((h) => ({
      outputs: runOutputs(h.run, h.nodeExecutions),
      ...(h.run.completedAt ? { completedAt: h.run.completedAt } : {}),
    })),
  };
}

export type ResolvedView =
  | { ok: true; source: 'declared' | 'generated'; components: ViewComponent[]; dataModel: ViewDataModel }
  | { ok: false; source: 'declared' | 'generated'; errors: string[] };

/**
 * The view to show for an agent's run: its declared components, or the
 * component list its `from` node produced this run (validated now, since it's
 * model output). Undefined when the agent has no view.
 */
export function resolveAgentView(
  agent: { view?: AgentView; permissions?: { imgSrc?: string[] } },
  args: Parameters<typeof buildViewDataModel>[0],
): ResolvedView | undefined {
  const view = agent.view;
  if (!view) return undefined;
  const opts = { imgHosts: agent.permissions?.imgSrc ?? [] };
  const dataModel = buildViewDataModel(args);
  if ('components' in view) {
    const v = validateViewComponents(view.components, opts);
    return v.ok ? { ok: true, source: 'declared', components: v.components, dataModel } : { ok: false, source: 'declared', errors: v.errors };
  }
  const exec = args.nodeExecutions.find((e) => e.nodeId === view.from);
  if (!exec || exec.status !== 'completed') {
    return { ok: false, source: 'generated', errors: [`Node "${view.from}" didn't complete in this run, so there's no view to show.`] };
  }
  const outputs = parseObject(exec.outputsJson);
  const text = typeof outputs?.view === 'string' ? outputs.view
    : outputs?.view !== undefined ? JSON.stringify(outputs.view)
    : exec.result ?? '';
  const extracted = extractGeneratedView(text);
  if (!extracted) return { ok: false, source: 'generated', errors: [`Node "${view.from}" didn't produce an A2UI component list (expected <a2ui>…</a2ui> JSON).`] };
  const v = validateViewComponents(extracted.components, opts);
  if (!v.ok) return { ok: false, source: 'generated', errors: v.errors };
  return { ok: true, source: 'generated', components: v.components, dataModel: { ...dataModel, ...(extracted.data !== undefined ? { data: extracted.data } : {}) } };
}

/** The A2UI v0.9 messages that draw a view on a surface. */
export function viewToMessages(surfaceId: string, components: ViewComponent[], dataModel: unknown): Array<Record<string, unknown>> {
  return [
    { version: A2UI_PROTOCOL_VERSION, createSurface: { surfaceId, catalogId: SUA_CATALOG_ID } },
    { version: A2UI_PROTOCOL_VERSION, updateComponents: { surfaceId, components } },
    { version: A2UI_PROTOCOL_VERSION, updateDataModel: { surfaceId, value: dataModel } },
  ];
}

/** Resolve an absolute JSON-pointer path (`/a/b/0`) in a data model. */
export function resolvePointer(data: unknown, path: string): unknown {
  if (!path.startsWith('/')) return undefined;
  let cur: unknown = data;
  for (const raw of path.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Make a validated view safe to send to the browser. `SanitizedHtml.html` is
 * resolved here (a literal, or an absolute data path) and run through sua's
 * allowlist sanitizer, then sent as a literal: the browser never receives
 * unsanitized HTML, and never resolves an HTML binding itself. A binding that
 * can't be resolved safely (relative to a list item, or a function) renders
 * as a note instead. Returns new component objects; the input isn't changed.
 */
export function prepareViewForRender(components: ViewComponent[], dataModel: unknown): ViewComponent[] {
  return components.map((c) => {
    if (c.component !== 'SanitizedHtml') return c;
    const raw = c.html;
    let value: unknown;
    if (typeof raw === 'string') value = raw;
    else if (raw && typeof raw === 'object' && typeof (raw as { path?: unknown }).path === 'string') {
      const path = (raw as { path: string }).path;
      value = path.startsWith('/') ? resolvePointer(dataModel, path) : undefined;
      if (!path.startsWith('/')) return { ...c, html: '<p><em>HTML inside a list can\'t be shown safely; bind it with an absolute path.</em></p>' };
    }
    return { ...c, html: typeof value === 'string' ? sanitizeHtml(value) : '' };
  });
}
