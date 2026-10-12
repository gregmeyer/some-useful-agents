import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import express from 'express';
import { assetsRouter } from '../routes/assets.js';

// A browser module (assets/chart-math.js); a computed path keeps tsc from typing it.
const here = dirname(fileURLToPath(import.meta.url));
const modPath = join(here, '..', 'assets', 'chart-math.js');
const { niceTicks, nearestPoint, fullValue, pointNote, pointHref } = await import(modPath) as {
  niceTicks: (lo: number, hi: number, count?: number) => number[];
  nearestPoint: <T extends { px: number; py: number }>(pts: T[], x: number, y: number, reach: number) => T | undefined;
  fullValue: (n: number, money?: boolean) => string;
  pointNote: (a: Record<string, unknown>) => { name: string; values: string; status: string };
  pointHref: (v: unknown) => string | undefined;
};

describe('niceTicks', () => {
  it('gives round values instead of quarters of the range', () => {
    // The car notebook's price axis used to read $3.1k, $4k, $4.9k, $5.8k.
    expect(niceTicks(2830, 6290)).toEqual([3000, 4000, 5000, 6000]);
    expect(niceTicks(131000, 184000)).toEqual([140000, 160000, 180000]);
  });
  it('handles small, flat and reversed ranges', () => {
    expect(niceTicks(0, 1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(5, 5).length).toBeGreaterThan(0);
    expect(niceTicks(10, 0)).toEqual(niceTicks(0, 10));
    expect(niceTicks(NaN, 1)).toEqual([]);
  });
});

describe('nearestPoint', () => {
  const pts = [{ id: 'a', px: 10, py: 10 }, { id: 'b', px: 14, py: 10 }, { id: 'c', px: 100, py: 100 }];
  it('picks the closest point within reach, so overlapping dots can be told apart', () => {
    expect(nearestPoint(pts, 13, 10, 18)?.id).toBe('b');
    expect(nearestPoint(pts, 11, 10, 18)?.id).toBe('a');
  });
  it('returns nothing out of reach', () => {
    expect(nearestPoint(pts, 50, 50, 18)).toBeUndefined();
  });
});

describe('pointNote (what a hovered dot says)', () => {
  const base = { name: '2008 Wagon', x: 177967, y: 3495, xLabel: 'Miles', yLabel: 'Price', xMoney: false, yMoney: true };
  it('writes both values in full', () => {
    expect(pointNote(base)).toEqual({ name: '2008 Wagon', values: 'Price $3,495 · Miles 177,967', status: '' });
    expect(fullValue(4.5)).toBe('4.5');
    expect(fullValue(-1200, true)).toBe('-$1,200');
  });
  it('says where it stands', () => {
    expect(pointNote({ ...base, best: true, bestWord: 'best price', stage: 'Found', inLimits: true }).status).toBe('best price · Found');
    expect(pointNote({ ...base, inLimits: false }).status).toBe('outside your limits');
    expect(pointNote({ ...base, ruledOut: { reason: 'No reply' }, stage: 'Checked' }).status).toBe('ruled out: No reply');
    expect(pointNote({ ...base, ruledOut: { gone: true } }).status).toBe('no longer available');
    expect(pointNote({ ...base, name: ' ' }).name).toBe('Untitled');
  });
});

describe('pointHref (where a clicked dot goes)', () => {
  it('opens only paths on this dashboard', () => {
    expect(pointHref('/notebooks/car/entries/abc')).toBe('/notebooks/car/entries/abc');
    for (const bad of ['https://example.com/x', '//example.com/x', 'javascript:alert(1)', '/a b', '/a\\b', '', 3, undefined]) expect(pointHref(bad)).toBeUndefined();
  });
});

describe('the Scatter component', () => {
  it('imports the chart math, which the dashboard serves', async () => {
    const js = readFileSync(join(here, '..', 'assets', 'a2ui-sua.js'), 'utf8');
    expect(js).toContain("from '/assets/chart-math.js'");
    const app = express().use(assetsRouter);
    const res = await request(app).get('/assets/chart-math.js');
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/javascript');
    expect(res.text).toContain('export function niceTicks');
  });
});
