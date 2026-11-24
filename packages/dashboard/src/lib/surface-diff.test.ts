import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import express from 'express';
import { assetsRouter } from '../routes/assets.js';

// A browser module (assets/surface-diff.js); a computed path keeps tsc from typing it.
const here = dirname(fileURLToPath(import.meta.url));
type Kept = { surfaceId: string; byId: Map<string, string>; data: unknown };
const { surfaceDelta, dataChanges, componentsOf, dataOf } = await import(join(here, '..', 'assets', 'surface-diff.js')) as {
  surfaceDelta: (kept: Kept, messages: unknown[]) => { messages: Array<Record<string, unknown>>; changed: number; paths: number; next: Kept } | null;
  dataChanges: (a: unknown, b: unknown) => Array<[string, unknown]>;
  componentsOf: (m: unknown[]) => Array<{ id: string }>;
  dataOf: (m: unknown[]) => unknown;
};

const msgs = (components: unknown[], data: unknown, surfaceId = 'notebook-x') => [
  { version: '1.0', createSurface: { surfaceId, catalogId: 'sua' } },
  { version: '1.0', updateComponents: { surfaceId, components } },
  { version: '1.0', updateDataModel: { surfaceId, value: data } },
];
const keptOf = (m: unknown[]): Kept => ({ surfaceId: 'notebook-x', byId: new Map(componentsOf(m).map((c) => [c.id, JSON.stringify(c)])), data: dataOf(m) });

describe('a drawn surface takes a new copy of itself in place (ADR-0086)', () => {
  const root = { id: 'root', component: 'Column', children: ['answer', 'findings'] };
  const answer = { id: 'answer', component: 'Callout', text: { path: '/notebook/answer/text' } };
  const findings = { id: 'findings', component: 'Agenda', points: { path: '/notebook/findings' } };
  const before = msgs([root, answer, findings], { notebook: { answer: { text: 'Draft' }, findings: [], steps: [1] } });

  it('nothing changed: nothing is sent', () => {
    expect(surfaceDelta(keptOf(before), before)).toMatchObject({ messages: [], changed: 0, paths: 0 });
  });

  it('a part appears: only it and its parent are sent; only the data paths that changed go, a gone key as null', () => {
    const sources = { id: 'sources', component: 'Agenda', points: { path: '/notebook/sources' } };
    const after = msgs([{ ...root, children: ['answer', 'findings', 'sources'] }, answer, findings, sources], { notebook: { answer: { text: 'Final' }, findings: ['A'], sources: ['x'] } });
    const d = surfaceDelta(keptOf(before), after)!;
    expect(d.messages[0]).toEqual({ version: '1.0', updateComponents: { surfaceId: 'notebook-x', components: [{ ...root, children: ['answer', 'findings', 'sources'] }, sources] } });
    expect(d.messages.slice(1).map((m) => m.updateDataModel)).toEqual([
      { surfaceId: 'notebook-x', path: '/notebook/answer', value: { text: 'Final' } },
      { surfaceId: 'notebook-x', path: '/notebook/findings', value: ['A'] },
      { surfaceId: 'notebook-x', path: '/notebook/steps', value: null },
      { surfaceId: 'notebook-x', path: '/notebook/sources', value: ['x'] },
    ]);
    expect(d).toMatchObject({ changed: 2, paths: 4 });
    // Applied, it's the new copy: the same messages again send nothing.
    expect(surfaceDelta(d.next, after)!.messages).toEqual([]);
  });

  it("can't be applied in place to another surface, or without a root", () => {
    expect(surfaceDelta(keptOf(before), msgs([root, answer], {}, 'board-y'))).toBeNull();
    expect(surfaceDelta(keptOf(before), msgs([answer], {}))).toBeNull();
  });

  it('paths are JSON pointers, escaped', () => {
    expect(dataChanges({ a: { 'x/y': 1 } }, { a: { 'x/y': 2 } })).toEqual([['/a/x~1y', 2]]);
    expect(dataChanges([1], [2])).toEqual([['/', [2]]]);
  });

  it('is served to the page', async () => {
    const res = await request(express().use(assetsRouter)).get('/assets/surface-diff.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('export function surfaceDelta');
  });
});
