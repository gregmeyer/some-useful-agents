/**
 * sua's A2UI agent functions, answered (ADR-0088). A notebook page's renderer
 * sends a call it can't make itself (`callAgentFunction`); this answers with
 * `agentFunctionResponse`: a value, or an error it draws as nothing.
 *
 * Only a notebook's own page may call, and only about that notebook: the
 * surface id names the notebook (`notebook-<id>`, its header
 * `notebook-<id>-header`), and every answer comes from that notebook alone.
 * Nothing is changed: these only read. Pure but for the store it reads.
 */
import { NotebookStore, SUA_AGENT_FUNCTION_NAMES, notebookViewData, rankOptions, type Notebook, type NotebookViewOption } from '@some-useful-agents/core';
import { formatFieldValue } from './field-format.js';

export interface AgentFunctionResponse {
  version: '1.0';
  agentFunctionResponse: { functionCallId: string; value?: unknown; error?: { code: string; message: string } };
}

const FIND_LIMIT = 10;
const FIND_MAX = 50;

/** The notebook a surface is the page of, or undefined. */
export function surfaceNotebook(store: Pick<NotebookStore, 'get'>, surfaceId: unknown): Notebook | undefined {
  if (typeof surfaceId !== 'string' || !surfaceId.startsWith('notebook-')) return undefined;
  const id = surfaceId.slice('notebook-'.length);
  return store.get(id) ?? (id.endsWith('-header') ? store.get(id.slice(0, -'-header'.length)) : undefined);
}

/** An option as a row: its id, name, own page here, its link, and each fact by field key as the page says it. */
function row(nb: Notebook, o: NotebookViewOption): Record<string, unknown> {
  const facts = Object.fromEntries(nb.fields.filter((f) => o.fields[f.key] !== undefined && o.fields[f.key] !== '').map((f) => [f.key, formatFieldValue(f, o.fields[f.key]!)]));
  return { ...facts, id: o.id, name: o.name, title: o.title, page: `/notebooks/${encodeURIComponent(nb.id)}/entries/${encodeURIComponent(o.id)}`, ...(o.link ? { link: o.link } : {}) };
}

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

export function answerAgentFunction(store: NotebookStore, message: unknown): AgentFunctionResponse | undefined {
  const call = (message as { callAgentFunction?: { functionCallId?: unknown; surfaceId?: unknown; callFunction?: Record<string, unknown> } } | undefined)?.callAgentFunction;
  if (!call || typeof call.functionCallId !== 'string' || !call.functionCallId) return undefined;
  const fail = (code: string, msg: string): AgentFunctionResponse => ({ version: '1.0', agentFunctionResponse: { functionCallId: call.functionCallId as string, error: { code, message: msg } } });
  const ok = (value: unknown): AgentFunctionResponse => ({ version: '1.0', agentFunctionResponse: { functionCallId: call.functionCallId as string, value } });
  const name = call.callFunction?.['@call'] ?? call.callFunction?.call;
  const args = (call.callFunction?.args && typeof call.callFunction.args === 'object' ? call.callFunction.args : {}) as Record<string, unknown>;
  if (typeof name !== 'string' || !SUA_AGENT_FUNCTION_NAMES.includes(name)) return fail('NOT_FOUND', `No agent function '${String(name)}'.`);
  const nb = surfaceNotebook(store, call.surfaceId);
  if (!nb) return fail('NOT_FOUND', 'That page is not a notebook’s.');
  const options = rankOptions(nb, notebookViewData(nb, store.entries(nb.id, 1000)).notebook.options.filter((o) => !o.ruledOut));
  if (name === 'findOptions') {
    const want = words(typeof args.q === 'string' ? args.q : '');
    const n = Math.min(FIND_MAX, Math.max(1, Math.round(Number(args.limit) || FIND_LIMIT)));
    const hay = (o: NotebookViewOption) => `${o.title} ${o.name} ${Object.values(o.fields).map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' ')}`.toLowerCase();
    return ok(options.filter((o) => want.every((w) => hay(o).includes(w))).slice(0, n).map((o) => row(nb, o)));
  }
  // optionFacts
  const o = options.find((x) => x.id === args.id) ?? notebookViewData(nb, store.entries(nb.id, 1000)).notebook.options.find((x) => x.id === args.id);
  if (!o) return fail('NOT_FOUND', 'No such option in this notebook.');
  return ok(nb.fields.filter((f) => o.fields[f.key] !== undefined && o.fields[f.key] !== '' && f.role !== 'image').map((f) => ({ label: f.label, value: formatFieldValue(f, o.fields[f.key]!) })));
}
