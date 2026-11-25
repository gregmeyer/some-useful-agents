/**
 * A notebook file (`.suanb`): one notebook, copied from one sua to another
 * (your laptop and your desktop). It carries everything the notebook keeps
 * (its setup, steps, page, options and their facts, pictures, write-up, what
 * you gave it) plus the agents and tools of yours it runs, and the names of
 * the secrets they need (never their values). It doesn't carry the
 * conversation it was talked about in, its runs, or its undo histories.
 *
 * Importing checks everything first: missing agents and tools of yours are
 * installed, ones you have are used as they are (a different one here is
 * kept and reported), and a notebook id or entry id already used here is
 * given a new one, with every reference to it following. The copy comes in
 * with its schedule off, so two machines don't both fill it.
 *
 * Format: gzipped JSON, `format: "suanb/1"`. See docs/notebooks.md.
 */
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { exportAgent, parseAgent } from './agent-yaml.js';
import { calledAgentIds } from './agent-tool.js';
import { saveUserTool, checkUserToolYaml, toolIdsUsed } from './user-tools.js';
import { isUserRunTool } from './user-tool-inputs.js';
import { NOTEBOOK_ROW_TABLES, type NotebookRows, type NotebookStore } from './notebooks.js';
import type { AgentStore } from './agent-store.js';
import type { ToolStore } from './tool-store.js';
import type { Agent } from './agent-v2-types.js';

export const NOTEBOOK_FILE_FORMAT = 'suanb/1';
/** The most a notebook file may unpack to. */
export const NOTEBOOK_FILE_MAX_BYTES = 200 * 1024 * 1024;

export interface NotebookBundle {
  format: typeof NOTEBOOK_FILE_FORMAT;
  meta: { exportedAt: string; machine: string; notebookId: string; title: string };
  /** Raw rows per table; blobs as `{ "$b64": "…" }`. */
  rows: NotebookRows;
  /** Agents of yours it runs (and the agents they call), as YAML. */
  agents: Array<{ id: string; yaml: string }>;
  /** Shipped agents it runs, by id (every sua has them, unless removed). */
  exampleAgents: string[];
  /** Tools of yours those agents use, as YAML. */
  tools: Array<{ id: string; yaml: string }>;
  /** Secret names those agents declare. Never values. */
  secrets: string[];
}

export interface BundleStores {
  notebooks: NotebookStore;
  agents: AgentStore;
  tools?: ToolStore;
}

export class NotebookFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotebookFileError';
  }
}

const B64 = '$b64';

function encodeRows(rows: NotebookRows): NotebookRows {
  const out: NotebookRows = {};
  for (const [table, list] of Object.entries(rows) as Array<[keyof NotebookRows, Array<Record<string, unknown>>]>) {
    out[table] = list.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Uint8Array ? { [B64]: Buffer.from(v).toString('base64') } : v])));
  }
  return out;
}

function decodeValue(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, unknown>)[B64] === 'string') {
    return new Uint8Array(Buffer.from((v as Record<string, string>)[B64], 'base64'));
  }
  return v;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** The agent ids a notebook runs: its pipeline and its steps' agents. Pure. */
export function notebookAgentIds(row: Record<string, unknown>): string[] {
  const ids = new Set<string>(parseJson<unknown[]>(row.pipeline_json, []).filter((x): x is string => typeof x === 'string'));
  for (const step of parseJson<Array<Record<string, unknown>>>(row.steps_json, [])) {
    if (step && typeof step.agentId === 'string') ids.add(step.agentId);
  }
  return [...ids];
}

function secretNames(agent: Agent): string[] {
  const names = new Set<string>();
  for (const n of agent.nodes) for (const s of n.secrets ?? []) names.add(s);
  return [...names];
}

/** Everything one notebook needs, ready to write as a notebook file. Undefined when there's no such notebook. */
export function exportNotebookBundle(stores: BundleStores, id: string, opts: { machine?: string; now?: Date } = {}): NotebookBundle | undefined {
  const rows = stores.notebooks.exportRows(id);
  if (!rows) return undefined;
  const nb = rows.notebooks![0];
  // What only means something on this machine.
  rows.notebooks = [{ ...nb, conversation_id: null, experiment_id: null, experiment_run_json: null, cadence_fired_at: null, archived_at: null }];
  rows.notebook_attachments = (rows.notebook_attachments ?? []).map((r) => ({ ...r, thread_id: null }));

  const agents: NotebookBundle['agents'] = [];
  const exampleAgents = new Set<string>();
  const tools = new Map<string, string>();
  const secrets = new Set<string>();
  const seen = new Set<string>();
  const visit = (agentId: string) => {
    if (seen.has(agentId)) return;
    seen.add(agentId);
    const a = stores.agents.getAgent(agentId);
    if (!a) return;
    for (const s of secretNames(a)) secrets.add(s);
    if (a.source !== 'local') { exampleAgents.add(agentId); return; }
    agents.push({ id: agentId, yaml: exportAgent(a) });
    for (const t of toolIdsUsed(a)) {
      if (tools.has(t) || !stores.tools) continue;
      const def = stores.tools.getTool(t);
      if (def && isUserRunTool(def) && !stores.tools.getToolServerId(t) && def.yamlText) tools.set(t, def.yamlText);
    }
    for (const called of calledAgentIds(a)) visit(called);
  };
  for (const agentId of notebookAgentIds(nb)) visit(agentId);

  return {
    format: NOTEBOOK_FILE_FORMAT,
    meta: { exportedAt: (opts.now ?? new Date()).toISOString(), machine: opts.machine ?? hostname(), notebookId: id, title: String(nb.title ?? id) },
    rows: encodeRows(rows),
    agents,
    exampleAgents: [...exampleAgents],
    tools: [...tools].map(([toolId, yaml]) => ({ id: toolId, yaml })),
    secrets: [...secrets].sort(),
  };
}

/** The notebook file's bytes (gzipped JSON). */
export function packNotebookBundle(bundle: NotebookBundle): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'));
}

/** A notebook file read back, or NotebookFileError saying why it can't be. */
export function unpackNotebookBundle(bytes: Uint8Array): NotebookBundle {
  let text: string;
  try {
    text = gunzipSync(bytes, { maxOutputLength: NOTEBOOK_FILE_MAX_BYTES }).toString('utf8');
  } catch (err) {
    const tooBig = err instanceof RangeError || /maxOutputLength|buffer|too large/i.test(String((err as Error).message));
    throw new NotebookFileError(tooBig ? 'That notebook file is too big (over 200 MB unpacked).' : "That isn't a notebook file (it doesn't unpack).");
  }
  let b: unknown;
  try { b = JSON.parse(text); } catch { throw new NotebookFileError("That isn't a notebook file (it isn't JSON inside)."); }
  const bundle = b as Partial<NotebookBundle>;
  if (!bundle || bundle.format !== NOTEBOOK_FILE_FORMAT) {
    throw new NotebookFileError(bundle && typeof bundle.format === 'string' ? `This notebook file is format ${bundle.format}; this sua reads ${NOTEBOOK_FILE_FORMAT}. Update sua and try again.` : "That isn't a notebook file.");
  }
  if (!bundle.rows?.notebooks?.[0] || !bundle.meta || !Array.isArray(bundle.agents) || !Array.isArray(bundle.tools)) {
    throw new NotebookFileError('That notebook file is incomplete.');
  }
  return { exampleAgents: [], secrets: [], ...bundle } as NotebookBundle;
}

export type AgentPlan = { id: string; action: 'install' | 'same' | 'yours-differs'; version?: number } | { id: string; action: 'missing-example' };

export interface NotebookImportPlan {
  title: string;
  /** The id it will have here. */
  notebookId: string;
  /** Its id was taken here, so it gets a new one. */
  renamed: boolean;
  /** Some of its entry ids were taken here, so they all get new ones. */
  newEntryIds: boolean;
  agents: AgentPlan[];
  tools: Array<{ id: string; action: 'install' | 'same' | 'yours-differs' }>;
  /** Secrets its agents need that this machine doesn't have. */
  missingSecrets: string[];
  /** The schedule it had, now off here; empty when it had none. */
  scheduleWas: string;
  counts: { options: number; notes: number; pictures: number };
  from: { machine: string; exportedAt: string };
  /** Why it can't be imported (empty when it can). */
  problems: string[];
}

/** Whether two agent definitions are the same, apart from the version number each machine counts for itself. */
const sameAgentYaml = (a: string, b: string): boolean => {
  const norm = (y: string) => { try { return exportAgent(parseAgent(y)).replace(/^version:.*$/m, ''); } catch { return y; } };
  return norm(a) === norm(b);
};

/** What importing this notebook file would do here, without doing it. */
export function checkNotebookBundle(stores: BundleStores, bundle: NotebookBundle, opts: { hasSecret?: (name: string) => boolean } = {}): NotebookImportPlan {
  const problems: string[] = [];
  const nb = bundle.rows.notebooks![0];
  const oldId = String(nb.id);
  let notebookId = oldId;
  for (let n = 2; stores.notebooks.get(notebookId); n++) notebookId = `${oldId.slice(0, 44)}-${String(n)}`;
  const entryIds = (bundle.rows.notebook_entries ?? []).map((e) => String(e.id));
  const passIds = (bundle.rows.notebook_passes ?? []).map((p) => String(p.id));

  const agents: AgentPlan[] = [];
  for (const { id, yaml } of bundle.agents) {
    try { if (parseAgent(yaml).id !== id) { problems.push(`The agent "${id}" in the file is named differently inside.`); continue; } } catch (err) {
      problems.push(`The agent "${id}" in the file doesn't read: ${(err as Error).message.split('\n')[0]}`);
      continue;
    }
    const here = stores.agents.getAgent(id);
    agents.push(!here ? { id, action: 'install' } : sameAgentYaml(exportAgent(here), yaml) ? { id, action: 'same', version: here.version } : { id, action: 'yours-differs', version: here.version });
  }
  for (const id of bundle.exampleAgents) if (!stores.agents.getAgent(id)) agents.push({ id, action: 'missing-example' });

  const tools: NotebookImportPlan['tools'] = [];
  for (const { id, yaml } of bundle.tools) {
    const here = stores.tools?.getTool(id);
    if (here) { tools.push({ id, action: (here.yamlText ?? '').trim() === yaml.trim() ? 'same' : 'yours-differs' }); continue; }
    const checked = checkUserToolYaml(yaml, stores.tools);
    if (!checked.tool) { problems.push(`The tool "${id}" in the file can't be added: ${checked.errors.join(' ')}`); continue; }
    if (!stores.tools) { problems.push(`The notebook's agents use the tool "${id}", and this sua has no tool store.`); continue; }
    tools.push({ id, action: 'install' });
  }

  const entries = bundle.rows.notebook_entries ?? [];
  return {
    title: String(nb.title ?? oldId),
    notebookId,
    renamed: notebookId !== oldId,
    newEntryIds: stores.notebooks.idsTaken(entryIds, passIds),
    agents,
    tools,
    missingSecrets: opts.hasSecret ? bundle.secrets.filter((s) => !opts.hasSecret!(s)) : [],
    scheduleWas: String(nb.cadence ?? ''),
    counts: {
      options: entries.filter((e) => e.kind === 'option').length,
      notes: entries.filter((e) => e.kind !== 'option').length,
      pictures: (bundle.rows.notebook_photos ?? []).length + (bundle.rows.notebook_about_photos ?? []).length,
    },
    from: { machine: bundle.meta.machine, exportedAt: bundle.meta.exportedAt },
    problems,
  };
}

/** Replace every whole occurrence of the map's keys in a string. */
function replaceAll(text: string, map: ReadonlyMap<string, string>): string {
  let out = text;
  for (const [from, to] of map) if (out.includes(from)) out = out.split(from).join(to);
  return out;
}

/** The rows with the ids they'll have here, the schedule off, blobs decoded. Pure. */
export function rowsForHere(bundle: NotebookBundle, plan: Pick<NotebookImportPlan, 'notebookId' | 'renamed' | 'newEntryIds'>): NotebookRows {
  const oldId = String(bundle.rows.notebooks![0].id);
  const ids = new Map<string, string>();
  if (plan.newEntryIds) {
    for (const e of bundle.rows.notebook_entries ?? []) ids.set(String(e.id), randomUUID());
    for (const p of bundle.rows.notebook_passes ?? []) ids.set(String(p.id), randomUUID());
  }
  // Links and photo keys that name the notebook (`/notebooks/<id>`, `notebook:<id>`).
  const links = new Map<string, string>(plan.renamed ? [[`/notebooks/${oldId}`, `/notebooks/${plan.notebookId}`], [`notebook:${oldId}`, `notebook:${plan.notebookId}`]] : []);
  const fix = (v: unknown): unknown => {
    const d = decodeValue(v);
    if (typeof d !== 'string') return d;
    const exact = ids.get(d);
    if (exact) return exact;
    return replaceAll(replaceAll(d, ids), links);
  };
  const out: NotebookRows = {};
  for (const table of ['notebooks', ...NOTEBOOK_ROW_TABLES] as const) {
    out[table] = (bundle.rows[table] ?? []).map((r) => {
      const row = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fix(v)]));
      if (table === 'notebooks') return { ...row, id: plan.notebookId, cadence: '', cadence_fired_at: null };
      return { ...row, notebook_id: plan.notebookId };
    });
  }
  return out;
}

export interface NotebookImportResult {
  notebookId: string;
  plan: NotebookImportPlan;
  installedAgents: string[];
  installedTools: string[];
}

/**
 * Import a notebook file: checked first, then its missing agents and tools
 * installed and its rows written; if writing fails, what was installed is
 * removed again. Throws NotebookFileError with the reasons when it can't.
 */
export function importNotebookBundle(stores: BundleStores, bundle: NotebookBundle, opts: { hasSecret?: (name: string) => boolean; now?: Date } = {}): NotebookImportResult {
  const plan = checkNotebookBundle(stores, bundle, opts);
  if (plan.problems.length) throw new NotebookFileError(plan.problems.join(' '));
  const installedAgents: string[] = [];
  const installedTools: string[] = [];
  const undo = () => {
    for (const id of installedTools.reverse()) { try { stores.tools?.deleteTool(id); } catch { /* keep going */ } }
    for (const id of installedAgents.reverse()) { try { stores.agents.deleteAgent(id); } catch { /* keep going */ } }
  };
  try {
    for (const t of plan.tools.filter((x) => x.action === 'install')) {
      saveUserTool(stores.tools!, bundle.tools.find((x) => x.id === t.id)!.yaml);
      installedTools.push(t.id);
    }
    for (const a of plan.agents.filter((x) => x.action === 'install')) {
      stores.agents.upsertAgent(parseAgent(bundle.agents.find((x) => x.id === a.id)!.yaml), 'import', `Copied with the notebook "${plan.title}"`);
      installedAgents.push(a.id);
    }
    stores.notebooks.importRows(rowsForHere(bundle, plan));
  } catch (err) {
    undo();
    throw err instanceof NotebookFileError ? err : new NotebookFileError(`Nothing was imported: ${(err as Error).message}`);
  }
  // Dates as this machine's calendar has them (not UTC).
  const day = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const exported = new Date(bundle.meta.exportedAt);
  const lines = [`Copied from ${bundle.meta.machine}, exported ${Number.isNaN(exported.getTime()) ? bundle.meta.exportedAt.slice(0, 10) : day(exported)}, imported ${day(opts.now ?? new Date())}.`];
  if (plan.scheduleWas) lines.push(`Its schedule (${plan.scheduleWas}) is off here, so two machines don't both fill it. Turn it on here if this machine should.`);
  if (plan.missingSecrets.length) lines.push(`Its agents need secrets this machine doesn't have: ${plan.missingSecrets.join(', ')}. Add them in Settings → Secrets.`);
  const differs = plan.agents.filter((a) => a.action === 'yours-differs').map((a) => a.id);
  if (differs.length) lines.push(`It runs your own ${differs.join(', ')} here, which ${differs.length === 1 ? 'differs' : 'differ'} from the copy's.`);
  const missing = plan.agents.filter((a) => a.action === 'missing-example').map((a) => a.id);
  if (missing.length) lines.push(`It uses ${missing.join(', ')}, which ${missing.length === 1 ? "isn't" : "aren't"} installed here.`);
  try { stores.notebooks.addEntry(plan.notebookId, { kind: 'note', title: 'Copied from another machine', body: lines.join(' '), by: 'sua' }); } catch { /* the note is a courtesy */ }
  return { notebookId: plan.notebookId, plan, installedAgents, installedTools };
}
