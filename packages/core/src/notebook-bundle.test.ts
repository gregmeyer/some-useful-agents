import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotebookStore } from './notebooks.js';
import { AgentStore } from './agent-store.js';
import { ToolStore } from './tool-store.js';
import { parseAgent } from './agent-yaml.js';
import { saveUserTool } from './user-tools.js';
import {
  exportNotebookBundle,
  packNotebookBundle,
  unpackNotebookBundle,
  checkNotebookBundle,
  importNotebookBundle,
  NotebookFileError,
  type BundleStores,
} from './notebook-bundle.js';

let dirs: string[] = [];
const open: Array<{ close(): void }> = [];

function machine(): BundleStores {
  const dir = mkdtempSync(join(tmpdir(), 'sua-nb-file-'));
  dirs.push(dir);
  const db = join(dir, 'runs.db');
  const s = { notebooks: new NotebookStore(db), agents: new AgentStore(db), tools: new ToolStore(db) };
  open.push(s.notebooks, s.agents, s.tools);
  return s;
}

afterEach(() => {
  for (const s of open.splice(0)) { try { s.close(); } catch { /* ignore */ } }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const TOOL = `id: board-jobs
name: Board jobs
inputs:
  company: { type: string, required: true }
implementation:
  type: shell
  command: |
    curl -sf "https://api.boards.test/$company/jobs"
`;

const FINDER = ['id: job-finder', 'name: Job finder', 'status: active', 'source: local',
  'nodes:', '  - id: fetch', '    type: shell', '    tool: board-jobs', '    toolInputs: { company: acme }', '    secrets: [BOARD_TOKEN]',
  '  - id: enrich', '    type: agent-invoke', '    dependsOn: [fetch]', '    agentInvokeConfig: { agentId: salary-lookup }'].join('\n');
const LOOKUP = ['id: salary-lookup', 'name: Salary lookup', 'status: active', 'source: local', 'nodes:', '  - id: look', '    type: llm-prompt', '    prompt: "Salary bands"'].join('\n');
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

function seed(a: BundleStores): { id: string; optionId: string } {
  saveUserTool(a.tools!, TOOL);
  a.agents.upsertAgent(parseAgent(LOOKUP), 'cli', 'fixture');
  a.agents.upsertAgent(parseAgent(FINDER), 'cli', 'fixture');
  const nb = a.notebooks.create({ title: 'Find a PM job', statement: 'A senior PM role', pipeline: ['job-finder'], cadence: '0 8 * * 1', given: [{ label: 'My résumé', text: 'Ten years of product work.' }] });
  const opt = a.notebooks.addEntry(nb.id, { kind: 'option', title: 'Senior PM · Acme', by: 'agent:job-finder' });
  a.notebooks.setOptionFacts(nb.id, opt.id, { salary: 200, company: 'Acme' });
  a.notebooks.addEntry(nb.id, { kind: 'note', title: 'Shortlist', body: `See [the Acme role](/notebooks/${nb.id}) — ${opt.id}`, by: 'you' });
  a.notebooks.savePhoto(nb.id, opt.id, 'https://img.test/acme.png', { contentType: 'image/png', bytes: PNG });
  a.notebooks.saveAboutPhoto(nb.id, 'person', 'https://img.test/me.png', { contentType: 'image/png', bytes: PNG }, 'photo');
  return { id: nb.id, optionId: opt.id };
}

describe('a notebook file', () => {
  it('carries the notebook, its agents (and the ones they call), its tools and secret names', () => {
    const a = machine();
    const { id } = seed(a);
    const bundle = exportNotebookBundle(a, id, { machine: 'laptop' })!;
    expect(bundle.format).toBe('suanb/1');
    expect(bundle.meta).toMatchObject({ machine: 'laptop', notebookId: id, title: 'Find a PM job' });
    expect(bundle.agents.map((x) => x.id).sort()).toEqual(['job-finder', 'salary-lookup']);
    expect(bundle.tools.map((x) => x.id)).toEqual(['board-jobs']);
    expect(bundle.secrets).toEqual(['BOARD_TOKEN']);
    expect(bundle.rows.notebook_photos![0].bytes).toHaveProperty('$b64');
    expect(bundle.rows.notebooks![0].conversation_id).toBeNull();
    expect(exportNotebookBundle(a, 'nope')).toBeUndefined();
  });

  it('round-trips to another machine: everything as it was, agents and tools installed, schedule off', () => {
    const a = machine();
    const { id, optionId } = seed(a);
    const file = packNotebookBundle(exportNotebookBundle(a, id, { machine: 'laptop' })!);
    const b = machine();
    const bundle = unpackNotebookBundle(file);
    const plan = checkNotebookBundle(b, bundle, { hasSecret: () => false });
    expect(plan).toMatchObject({ notebookId: id, renamed: false, newEntryIds: false, missingSecrets: ['BOARD_TOKEN'], scheduleWas: '0 8 * * 1', counts: { options: 1, notes: 1, pictures: 2 } });
    expect(plan.agents.map((x) => x.action)).toEqual(['install', 'install']);
    const r = importNotebookBundle(b, bundle, { hasSecret: () => false });
    expect(r.installedAgents.sort()).toEqual(['job-finder', 'salary-lookup']);
    expect(r.installedTools).toEqual(['board-jobs']);
    const nb = b.notebooks.get(id)!;
    expect(nb.statement).toBe('A senior PM role');
    expect(nb.cadence).toBe('');
    expect(nb.given?.[0]).toMatchObject({ label: 'My résumé', text: 'Ten years of product work.' });
    // Every entry row comes back column for column (the copy adds one note).
    const rowsOf = (x: BundleStores) => (x.notebooks.exportRows(id)!.notebook_entries ?? [])
      .filter((e) => e.title !== 'Copied from another machine').sort((p, q) => String(p.id).localeCompare(String(q.id)));
    expect(rowsOf(b)).toEqual(rowsOf(a));
    expect(rowsOf(b).some((e) => e.id === optionId)).toBe(true);
    expect(b.notebooks.hasPhoto(optionId)).toBe(true);
    expect(b.notebooks.aboutPhoto(id, 'person')?.bytes).toEqual(PNG);
    const note = b.notebooks.entries(id, 100).find((e) => e.title === 'Copied from another machine')!;
    expect(note.body).toMatch(/Copied from laptop[\s\S]*schedule \(0 8 \* \* 1\) is off here[\s\S]*BOARD_TOKEN/);
    expect(b.tools!.getTool('board-jobs')?.yamlText).toBe(TOOL);
  });

  it('gives a taken notebook id and taken entry ids new ones, and references follow', () => {
    const a = machine();
    const { id, optionId } = seed(a);
    const bundle = exportNotebookBundle(a, id)!;
    // Back onto the same machine: everything is taken.
    const plan = checkNotebookBundle(a, bundle);
    expect(plan).toMatchObject({ notebookId: `${id}-2`, renamed: true, newEntryIds: true });
    expect(plan.agents.map((x) => x.action)).toEqual(['same', 'same']);
    const r = importNotebookBundle(a, bundle);
    expect(r.notebookId).toBe(`${id}-2`);
    expect(r.installedAgents).toEqual([]);
    const copy = a.notebooks.entries(r.notebookId, 100);
    const opt = copy.find((e) => e.kind === 'option')!;
    expect(opt.id).not.toBe(optionId);
    const note = copy.find((e) => e.title === 'Shortlist')!;
    expect(note.body).toContain(`/notebooks/${id}-2)`);
    expect(note.body).toContain(opt.id);
    expect(note.body).not.toContain(optionId);
    expect(a.notebooks.hasPhoto(opt.id)).toBe(true);
    // The original is untouched.
    expect(a.notebooks.entries(id, 100).some((e) => e.id === optionId)).toBe(true);
  });

  it('uses an agent here that matches the copy, whatever its version number', () => {
    const a = machine();
    const { id } = seed(a);
    // Bump job-finder's version on the first machine without changing it in a way that matters.
    const f = a.agents.getAgent('job-finder')!;
    a.agents.upsertAgent({ ...f, nodes: [...f.nodes, { id: 'x', type: 'shell', command: 'echo x', dependsOn: ['enrich'] }] }, 'cli', 'v2');
    a.agents.upsertAgent({ ...f }, 'cli', 'v3 = v1 again');
    const bundle = exportNotebookBundle(a, id)!;
    const b = machine();
    importNotebookBundle(b, bundle);
    // Installed at v1 here, v3 there: the same agent.
    expect(checkNotebookBundle(b, bundle).agents.find((x) => x.id === 'job-finder')).toMatchObject({ action: 'same' });
  });

  it('keeps an agent of yours that differs here, and says so', () => {
    const a = machine();
    const { id } = seed(a);
    const bundle = exportNotebookBundle(a, id)!;
    const b = machine();
    b.agents.upsertAgent(parseAgent(LOOKUP.replace('Salary bands', 'Different prompt')), 'cli', 'mine');
    const plan = checkNotebookBundle(b, bundle);
    expect(plan.agents.find((x) => x.id === 'salary-lookup')).toMatchObject({ action: 'yours-differs' });
    const r = importNotebookBundle(b, bundle);
    expect(r.installedAgents).toEqual(['job-finder']);
    expect(b.agents.getAgent('salary-lookup')!.nodes[0].prompt).toBe('Different prompt');
    const note = b.notebooks.entries(r.notebookId, 100).find((e) => e.title === 'Copied from another machine')!;
    expect(note.body).toMatch(/your own salary-lookup here, which differs/);
  });

  it('refuses what isn\'t a notebook file, and changes nothing when an import fails', () => {
    expect(() => unpackNotebookBundle(new Uint8Array([1, 2, 3]))).toThrow(NotebookFileError);
    const a = machine();
    const { id } = seed(a);
    const bundle = exportNotebookBundle(a, id)!;
    expect(() => unpackNotebookBundle(packNotebookBundle({ ...bundle, format: 'suanb/9' as never }))).toThrow(/format suanb\/9/);
    const b = machine();
    // A bad agent in the file: nothing is installed or written.
    const bad = { ...bundle, agents: [...bundle.agents, { id: 'broken', yaml: 'id: [' }] };
    expect(() => importNotebookBundle(b, bad)).toThrow(/broken/);
    expect(b.agents.getAgent('job-finder')).toBeNull();
    expect(b.notebooks.get(id)).toBeUndefined();
    // Writing the rows fails: what was installed comes out again.
    const failing = { ...bundle, rows: { ...bundle.rows, notebook_entries: [...bundle.rows.notebook_entries!, { ...bundle.rows.notebook_entries![0] }] } };
    expect(() => importNotebookBundle(b, failing)).toThrow(/Nothing was imported/);
    expect(b.agents.getAgent('job-finder')).toBeNull();
    expect(b.tools!.getTool('board-jobs')).toBeUndefined();
    expect(b.notebooks.get(id)).toBeUndefined();
  });
});
