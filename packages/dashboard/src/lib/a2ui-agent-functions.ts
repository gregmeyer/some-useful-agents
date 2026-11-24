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
import { NotebookStore, SUA_AGENT_FUNCTION_NAMES, notebookViewData, rankOptions, type Notebook, type NotebookEntry, type NotebookViewOption } from '@some-useful-agents/core';
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

/** What an agent function answers for a notebook (its entries as read): a value, or an error. Pure. */
export function agentFunctionValue(nb: Notebook, entries: readonly NotebookEntry[], name: string, args: Record<string, unknown>): { value: unknown } | { error: { code: string; message: string } } {
  if (!SUA_AGENT_FUNCTION_NAMES.includes(name)) return { error: { code: 'NOT_FOUND', message: `No agent function '${name}'.` } };
  const all = notebookViewData(nb, entries).notebook.options;
  const options = rankOptions(nb, all.filter((o) => !o.ruledOut));
  if (name === 'findOptions') {
    const want = words(typeof args.q === 'string' ? args.q : '');
    const n = Math.min(FIND_MAX, Math.max(1, Math.round(Number(args.limit) || FIND_LIMIT)));
    const hay = (o: NotebookViewOption) => `${o.title} ${o.name} ${Object.values(o.fields).map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' ')}`.toLowerCase();
    return { value: options.filter((o) => want.every((w) => hay(o).includes(w))).slice(0, n).map((o) => row(nb, o)) };
  }
  // optionFacts
  const o = all.find((x) => x.id === args.id);
  if (!o) return { error: { code: 'NOT_FOUND', message: 'No such option in this notebook.' } };
  return { value: nb.fields.filter((f) => o.fields[f.key] !== undefined && o.fields[f.key] !== '' && f.role !== 'image').map((f) => ({ label: f.label, value: formatFieldValue(f, o.fields[f.key]!) })) };
}

export function answerAgentFunction(store: NotebookStore, message: unknown): AgentFunctionResponse | undefined {
  const call = (message as { callAgentFunction?: { functionCallId?: unknown; surfaceId?: unknown; callFunction?: Record<string, unknown> } } | undefined)?.callAgentFunction;
  if (!call || typeof call.functionCallId !== 'string' || !call.functionCallId) return undefined;
  const id = call.functionCallId;
  const name = call.callFunction?.['@call'] ?? call.callFunction?.call;
  const args = (call.callFunction?.args && typeof call.callFunction.args === 'object' ? call.callFunction.args : {}) as Record<string, unknown>;
  const nb = typeof name === 'string' && SUA_AGENT_FUNCTION_NAMES.includes(name) ? surfaceNotebook(store, call.surfaceId) : undefined;
  const out = typeof name !== 'string' || !SUA_AGENT_FUNCTION_NAMES.includes(name)
    ? { error: { code: 'NOT_FOUND', message: `No agent function '${String(name)}'.` } }
    : !nb ? { error: { code: 'NOT_FOUND', message: 'That page is not a notebook\u2019s.' } }
    : agentFunctionValue(nb, store.entries(nb.id, 1000), name, args);
  return { version: '1.0', agentFunctionResponse: { functionCallId: id, ...out } };
}
