import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotebookStore, RunStore } from '@some-useful-agents/core';
import { briefChartPictures } from './brief-charts.js';
import { renderPageBrief } from '../views/notebook-page-brief.js';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

describe("a notebook page's charts in its brief and PDF, as pictures (ADR-0091)", () => {
  it('draws each VegaChart to an SVG image on the server, from data in or bound inside its spec; one that fetches draws nothing of it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-charts-'));
    const s = NotebookStore.fromHandle(new RunStore(join(dir, 'runs.db')).databaseHandle());
    const nb = s.create({ title: 'Find jobs' });
    s.setFields(nb.id, [{ key: 'salary', label: 'Salary', type: 'money', role: 'price' }]);
    for (const [t, pay] of [['Manager · Omni', 200], ['Analyst · Webflow', 120]] as const) { const e = s.addEntry(nb.id, { kind: 'option', title: t, by: 'x' }); s.setOptionFacts(nb.id, e.id, { salary: pay }); }
    s.setLayout(nb.id, { components: [
      { id: 'root', component: 'Column', children: ['inline', 'bound'] },
      { id: 'inline', component: 'VegaChart', spec: { title: 'Pay by role', data: { values: [{ role: 'Manager', pay: 200 }, { role: 'Analyst', pay: 120 }] }, mark: 'bar', encoding: { x: { field: 'role', type: 'nominal' }, y: { field: 'pay', type: 'quantitative' } } } },
      { id: 'bound', component: 'VegaChart', height: 180, spec: { data: { values: { path: '/notebook/options' } }, mark: 'bar', encoding: { x: { field: 'name', type: 'nominal' }, y: { field: 'price', type: 'quantitative' } } } },
    ] });
    const nbNow = s.get(nb.id)!;
    const pics = await briefChartPictures(nbNow, s.entries(nb.id, 1000));
    expect([...pics.keys()]).toEqual(['inline', 'bound']);
    for (const uri of pics.values()) {
      expect(uri).toMatch(/^data:image\/svg\+xml;base64,/);
      const svg = Buffer.from(uri.split(',')[1], 'base64').toString();
      expect(svg).toMatch(/^<svg /);
      expect(svg).not.toMatch(/<script|href="http/);
    }
    expect(Buffer.from(pics.get('inline')!.split(',')[1], 'base64').toString()).toContain('Pay by role');
    const out = renderPageBrief({ nb: nbNow, entries: s.entries(nb.id, 1000), charts: pics });
    expect(out).toContain('<figure class="chart-pic"><img src="data:image/svg+xml;base64,');
    expect(out).toContain('alt="Pay by role"');
    // Without its picture (it couldn't be drawn), a chart still prints its data.
    expect(renderPageBrief({ nb: nbNow, entries: s.entries(nb.id, 1000) })).toContain('<figcaption class="eyebrow">Pay by role</figcaption>');
  });
});
