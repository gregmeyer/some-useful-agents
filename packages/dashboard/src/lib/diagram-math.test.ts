import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import express from 'express';
import { recomputeDiagram, diagramParamWords, type NotebookAnswerDiagram, type NotebookDiagramParam } from '@some-useful-agents/core';
import { answerDiagramView } from './answer-art.js';
import { assetsRouter } from '../routes/assets.js';

// A browser module (assets/diagram-math.js); a computed path keeps tsc from typing it.
const here = dirname(fileURLToPath(import.meta.url));
const modPath = join(here, '..', 'assets', 'diagram-math.js');
const browser = await import(modPath) as {
  recomputeDiagram: (d: NotebookAnswerDiagram, values: Partial<Record<NotebookDiagramParam['key'], number>>) => NotebookAnswerDiagram;
  layoutDiagram: (d: NotebookAnswerDiagram) => unknown;
  diagramParamWords: (key: NotebookDiagramParam['key'], value: number) => string;
};

const rung = (label: string, end: number, amount: number) => ({ label, start: 0, end, amount, rate: '4.4% APY' });
const FIXTURES: NotebookAnswerDiagram[] = [
  { type: 'ladder', rungs: [12, 24, 36, 48, 60].map((m) => rung(`${String(m)}-month CD`, m, 5000)), params: [{ key: 'amount', label: 'Amount', value: 25000, min: 5000, max: 75000, step: 500 }, { key: 'months', label: 'Longest term', value: 60, min: 15, max: 120, step: 1 }] },
  { type: 'ladder', rungs: [rung('a', 6, 1000), { label: 'b', start: 6, end: 18 }], params: [{ key: 'count', label: 'Rungs', value: 2, min: 2, max: 8, step: 1 }] },
  { type: 'split', total: 1500, parts: [{ label: 'Dinners', amount: 600 }, { label: 'Days out', amount: 500, note: 'tickets' }, { label: 'Loose', amount: 400 }], params: [{ key: 'amount', label: 'Budget', value: 1500, min: 300, max: 4500, step: 50 }] },
  { type: 'flow', nodes: [{ label: 'Decide' }, { label: 'Split', note: 'the rest' }] },
];
const MOVES: Array<Partial<Record<NotebookDiagramParam['key'], number>>> = [{}, { amount: 30000 }, { months: 90 }, { amount: 12345, months: 17 }, { count: 5 }, { count: 8, months: 120 }, { amount: 1000000 }];

describe('the browser diagram math', () => {
  it('recomputes and lays out exactly as the server does, on every fixture and move', () => {
    for (const d of FIXTURES) {
      for (const values of MOVES) {
        const ours = recomputeDiagram(d, values);
        const theirs = browser.recomputeDiagram(d, values);
        expect(theirs).toEqual(ours);
        const { source: _s, params: _p, ...view } = answerDiagramView(ours);
        expect(browser.layoutDiagram(ours)).toEqual(view);
      }
    }
    for (const [k, v] of [['amount', 25000], ['months', 18], ['months', 24], ['count', 1]] as const) expect(browser.diagramParamWords(k, v)).toBe(diagramParamWords(k, v));
  });

  it('is imported by the A2UI client, which the dashboard serves', async () => {
    const js = readFileSync(join(here, '..', 'assets', 'a2ui-sua.js'), 'utf8');
    expect(js).toContain("from '/assets/diagram-math.js'");
    const app = express().use(assetsRouter);
    const res = await request(app).get('/assets/diagram-math.js');
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/javascript');
    expect(res.text).toContain('export function recomputeDiagram');
  });
});
