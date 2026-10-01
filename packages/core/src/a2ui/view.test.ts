import { describe, it, expect } from 'vitest';
import { parseAgent } from '../agent-yaml.js';
import type { Run } from '../types.js';
import type { NodeExecutionRecord } from '../agent-v2-types.js';
import { suaCatalogComponentNames, suaComponentDocs } from './catalog.js';
import {
  buildViewDataModel,
  extractGeneratedView,
  resolveAgentView,
  validateViewComponents,
  viewToMessages,
} from './view.js';

const card = [
  { id: 'root', component: 'Card', child: 'col' },
  { id: 'col', component: 'Column', children: ['title', 'temp', 'rows'] },
  { id: 'title', component: 'Text', text: 'Weather', variant: 'h3' },
  { id: 'temp', component: 'Metric', label: 'Now', value: { path: '/outputs/temp' }, unit: '°C', tone: 'ok' },
  { id: 'rows', component: 'Table', rows: { path: '/outputs/hours' }, columns: [{ key: 'h', label: 'Hour' }, { key: 'url', label: 'More', format: 'link' }] },
];

describe('sua catalog', () => {
  it('has the A2UI basic components plus sua\'s own, each documented with a valid example', () => {
    const names = suaCatalogComponentNames();
    for (const n of ['Text', 'Card', 'Column', 'Row', 'List', 'Button', 'Image', 'Metric', 'Table', 'KeyValue', 'Badge', 'Link', 'Code', 'SanitizedHtml']) {
      expect(names).toContain(n);
    }
    for (const d of suaComponentDocs()) {
      const child = typeof d.example.child === 'string' ? [{ id: d.example.child, component: 'Text', text: 'x' }] : [];
      const v = validateViewComponents([{ ...d.example, id: 'root' }, ...child]);
      expect(v, `${d.name} example`).toMatchObject({ ok: true });
    }
  });
});

describe('validateViewComponents (the A2UI processor in strict mode, plus sua limits)', () => {
  it('accepts a valid view', () => {
    expect(validateViewComponents(card)).toMatchObject({ ok: true });
  });

  it('names the problem for each kind of mistake', () => {
    const err = (components: unknown, opts = {}) => {
      const v = validateViewComponents(components, opts);
      return v.ok ? 'ok' : v.errors.join(' | ');
    };
    expect(err([])).toMatch(/non-empty list/);
    expect(err([...card.slice(0, 4), { id: 'rows', component: 'Script', src: 'x' }])).toMatch(/Unknown component type 'Script'/);
    expect(err([...card.slice(0, 2), { id: 'title', component: 'Text', text: 42 }, ...card.slice(3)])).toMatch(/Validation failed for component 'Text'/);
    expect(err([...card.slice(0, 3), { ...card[3], onclick: 'alert(1)' }, card[4]])).toMatch(/Unrecognized key/);
    expect(err([card[0], { id: 'col', component: 'Column', children: ['title', 'ghost'] }, card[2]])).toMatch(/non-existent component 'ghost'/);
    expect(err([{ id: 'root', component: 'Disclosure', label: 'More', child: 'ghost' }])).toMatch(/non-existent component 'ghost'/);
    expect(err(card.slice(1))).toMatch(/Missing root/);
    expect(err([...card, { id: 'lonely', component: 'Text', text: 'x' }])).toMatch(/not reachable from 'root'/);
    expect(err(Array.from({ length: 201 }, (_, i) => ({ id: `c${i}`, component: 'Text', text: 'x' })))).toMatch(/at most 200 components/);
    expect(err([{ id: 'root', component: 'Text', text: 'x'.repeat(70_000) }])).toMatch(/at most 64 KB/);
  });

  it('checks literal image hosts against permissions.imgSrc and link schemes', () => {
    const img = (url: string) => [{ id: 'root', component: 'Image', url }];
    expect(validateViewComponents(img('https://images.example.com/a.png'))).toMatchObject({ ok: false });
    expect(validateViewComponents(img('https://images.example.com/a.png'), { imgHosts: ['*.example.com'] })).toMatchObject({ ok: true });
    expect(validateViewComponents(img('http://images.example.com/a.png'), { imgHosts: ['*.example.com'] })).toMatchObject({ ok: false });
    expect(validateViewComponents([{ id: 'root', component: 'Link', text: 'x', url: 'javascript:alert(1)' }])).toMatchObject({ ok: false });
    expect(validateViewComponents([{ id: 'root', component: 'Link', text: 'x', url: { path: '/outputs/url' } }])).toMatchObject({ ok: true });
    expect(validateViewComponents([{ id: 'root', component: 'Link', text: 'x', url: '/output-file?path=a.png' }])).toMatchObject({ ok: true });
    expect(validateViewComponents([{ id: 'root', component: 'Link', text: 'x', url: '//evil.example/x' }])).toMatchObject({ ok: false });
  });
});

describe('generated views', () => {
  it('extracts a component list from <a2ui> tags, a json fence, or bare JSON', () => {
    expect(extractGeneratedView(`Here you go:\n<a2ui>${JSON.stringify(card)}</a2ui>`)?.components).toEqual(card);
    expect(extractGeneratedView('```json\n' + JSON.stringify({ components: card, data: { x: 1 } }) + '\n```')).toEqual({ components: card, data: { x: 1 } });
    expect(extractGeneratedView(JSON.stringify(card))?.components).toEqual(card);
    expect(extractGeneratedView('no view here')).toBeUndefined();
  });
});

const run = (over: Partial<Run> = {}): Run => ({
  id: 'r1', agentName: 'w', status: 'completed', startedAt: '2026-10-01T10:00:00.000Z', completedAt: '2026-10-01T10:00:04.000Z',
  result: '{"temp":"21"}', triggeredBy: 'dashboard', usage: { costUsd: 0.01 } as Run['usage'], ...over,
});
const exec = (nodeId: string, over: Partial<NodeExecutionRecord> = {}): NodeExecutionRecord => ({
  runId: 'r1', nodeId, workflowVersion: 1, status: 'completed', startedAt: '2026-10-01T10:00:00.000Z', ...over,
} as NodeExecutionRecord);

describe('data model', () => {
  it('binds outputs (last structured node outputs, else the result as JSON), result, inputs, run facts and history', () => {
    const dm = buildViewDataModel({
      run: run(), inputs: { CITY: 'Lisbon' },
      nodeExecutions: [exec('a', { outputsJson: '{"temp":"19"}' }), exec('b', { outputsJson: '{"temp":"21","hours":[]}' })],
      history: [{ run: run({ id: 'r0', result: '{"temp":"18"}' }), nodeExecutions: [] }],
    });
    expect(dm.outputs).toEqual({ temp: '21', hours: [] });
    expect(dm.inputs).toEqual({ CITY: 'Lisbon' });
    expect(dm.run).toMatchObject({ id: 'r1', status: 'completed', durationMs: 4000, costUsd: 0.01 });
    expect(dm.history).toEqual([{ outputs: { temp: '18' }, completedAt: '2026-10-01T10:00:04.000Z' }]);
    expect(buildViewDataModel({ run: run(), nodeExecutions: [] }).outputs).toEqual({ temp: '21' });
  });
});

describe('resolveAgentView', () => {
  it('declared: validates and pairs the components with the run\'s data', () => {
    const r = resolveAgentView({ view: { components: card as never } }, { run: run(), nodeExecutions: [] });
    expect(r).toMatchObject({ ok: true, source: 'declared' });
    if (!r?.ok) throw new Error('expected a valid view');
    const msgs = viewToMessages('tile-w', r.components, r.dataModel);
    expect(msgs.map((m) => Object.keys(m).find((k) => k !== 'version'))).toEqual(['createSurface', 'updateComponents', 'updateDataModel']);
  });

  it('generated: takes the node\'s output, validates it, and reports bad model output instead of showing it', () => {
    const agent = { view: { from: 'design' } };
    const good = resolveAgentView(agent, { run: run(), nodeExecutions: [exec('design', { result: `<a2ui>${JSON.stringify({ components: card, data: { note: 'hi' } })}</a2ui>` })] });
    expect(good).toMatchObject({ ok: true, source: 'generated', dataModel: { data: { note: 'hi' } } });
    const bad = resolveAgentView(agent, { run: run(), nodeExecutions: [exec('design', { result: '<a2ui>[{"id":"root","component":"Script"}]</a2ui>' })] });
    expect(bad).toMatchObject({ ok: false, source: 'generated' });
    expect(resolveAgentView(agent, { run: run(), nodeExecutions: [exec('design', { result: 'sorry' })] })).toMatchObject({ ok: false });
    expect(resolveAgentView(agent, { run: run(), nodeExecutions: [] })).toMatchObject({ ok: false, errors: [expect.stringContaining("didn't complete")] });
    expect(resolveAgentView({}, { run: run(), nodeExecutions: [] })).toBeUndefined();
  });
});

describe('view: in agent YAML', () => {
  const base = 'id: w\nname: w\nnodes:\n  - id: design\n    type: shell\n    command: echo hi\n';
  it('round-trips a declared view and a generated one', () => {
    const declared = parseAgent(`${base}view:\n  components:\n    - { id: root, component: Metric, label: Now, value: { path: /outputs/temp } }\n`);
    expect(declared.view).toEqual({ components: [{ id: 'root', component: 'Metric', label: 'Now', value: { path: '/outputs/temp' } }] });
    expect(parseAgent(`${base}view:\n  from: design\n`).view).toEqual({ from: 'design' });
  });
  it('rejects an invalid declared view and a generated view naming a missing node', () => {
    expect(() => parseAgent(`${base}view:\n  components:\n    - { id: root, component: Script }\n`)).toThrow(/Unknown component type 'Script'/);
    expect(() => parseAgent(`${base}view:\n  from: nope\n`)).toThrow(/not a node in this agent/);
  });
});

describe('prepareViewForRender (SanitizedHtml never reaches the browser unsanitized)', () => {
  it('resolves literal and absolute-path html and sanitizes it; refuses list-relative bindings', async () => {
    const { prepareViewForRender, resolvePointer } = await import('./view.js');
    const dm = { outputs: { card: '<p onclick="x()">Hi<script>alert(1)</script></p>' } };
    const out = prepareViewForRender([
      { id: 'root', component: 'Column', children: ['a', 'b', 'c'] },
      { id: 'a', component: 'SanitizedHtml', html: '<b>ok</b><img src=x onerror=alert(1)>' },
      { id: 'b', component: 'SanitizedHtml', html: { path: '/outputs/card' } },
      { id: 'c', component: 'SanitizedHtml', html: { path: 'item/html' } },
    ], dm);
    expect(out[1].html).toContain('<b>ok</b>');
    expect(String(out[1].html)).not.toMatch(/onerror/);
    expect(String(out[2].html)).toContain('Hi');
    expect(String(out[2].html)).not.toMatch(/<script|onclick/);
    expect(String(out[3].html)).toMatch(/can't be shown safely/);
    expect(out[0]).toEqual({ id: 'root', component: 'Column', children: ['a', 'b', 'c'] });
    expect(resolvePointer({ a: { 'b/c': [1, 2] } }, '/a/b~1c/1')).toBe(2);
  });
});
