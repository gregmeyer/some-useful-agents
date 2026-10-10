import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import express from 'express';
import { assetsRouter } from '../routes/assets.js';

// A browser module (assets/option-filters.js); a computed path keeps tsc from typing it.
const here = dirname(fileURLToPath(import.meta.url));
type Opt = Record<string, unknown>;
const { filterChoices, applyFilters, liveSelection, filterValue } = await import(join(here, '..', 'assets', 'option-filters.js')) as {
  filterChoices: (o: Opt[], f: unknown, opts?: Record<string, unknown>) => Array<{ key: string; label: string; choices: Array<{ value: string; count: number }> }>;
  applyFilters: (o: Opt[], sel: Record<string, string>, fmt?: unknown) => Opt[];
  liveSelection: (sel: Record<string, string>, c: unknown) => Record<string, string>;
  filterValue: (o: Opt, key: string) => string;
};

const cars: Opt[] = [
  { id: 'a', stage: 'Found', notSeenLately: false, fields: { seller: 'Dealer', awd: true } },
  { id: 'b', stage: 'Checked', notSeenLately: true, fields: { seller: 'Private', awd: true } },
  { id: 'c', stage: 'Found', notSeenLately: false, fields: { seller: 'Dealer', awd: false } },
  { id: 'd', stage: 'Found', notSeenLately: false, fields: { seller: 'Dealer' }, ruledOut: { reason: 'x' } },
];

describe('option filters', () => {
  it('offers each declared filter with the values the options have, and hides ones where they all agree', () => {
    const c = filterChoices(cars, ['seen', 'stage', { key: 'seller', label: 'Who sells it' }, 'awd', 'color'], { stages: ['Found', 'Checked', 'Test drive'], label: (k: string) => k.toUpperCase() });
    expect(c.map((f) => f.key)).toEqual(['seen', 'stage', 'seller', 'awd']); // color: nobody has one
    expect(c[0]).toEqual({ key: 'seen', label: 'Listing', choices: [{ value: 'Current', count: 3 }, { value: 'Not seen lately', count: 1 }] });
    expect(c[1].choices.map((x) => x.value)).toEqual(['Found', 'Checked']); // stage order, ruled out has none
    expect(c[2].label).toBe('Who sells it');
    expect(c[3]).toMatchObject({ label: 'AWD', choices: [{ value: 'Yes', count: 2 }, { value: 'No', count: 1 }] });
    expect(filterChoices(cars, ['stage'], {}).length).toBe(1);
    expect(filterChoices(cars.slice(0, 1), ['stage'])).toEqual([]);
  });

  it("skips a fact where every option has its own value, or that reads as a sentence", () => {
    const accounts: Opt[] = [
      { id: '1', notSeenLately: false, fields: { company: 'Adyen', value: 'Office-of-CFO suite: close, consolidation, compliance, disclosure', tier: 'Strong' } },
      { id: '2', notSeenLately: true, fields: { company: 'Akuity', value: 'Office-of-CFO suite: close, consolidation, compliance, disclosure', tier: 'Strong' } },
      { id: '3', notSeenLately: false, fields: { company: 'Board', value: 'Finance-led FP&A that keeps Excel-centered workflows', tier: 'Possible' } },
    ];
    const c = filterChoices(accounts, ['seen', 'company', 'value', 'tier']);
    // company: one each; value: shared but a sentence; tier: short and shared.
    expect(c.map((f) => f.key)).toEqual(['seen', 'tier']);
    // Built-ins always count, even when each value is held once.
    expect(filterChoices(accounts.slice(1), ['seen']).map((f) => f.key)).toEqual(['seen']);
  });

  it('keeps the options every chosen filter matches', () => {
    expect(applyFilters(cars, {}).map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(applyFilters(cars, { seen: 'Current', seller: 'Dealer' }).map((o) => o.id)).toEqual(['a', 'c', 'd']);
    expect(applyFilters(cars, { seen: 'Current', awd: 'Yes' }).map((o) => o.id)).toEqual(['a']);
    expect(filterValue(cars[3], 'stage')).toBe('');
  });

  it('counts each choice among what the other chosen filters keep', () => {
    const c = filterChoices(cars, ['seen', 'seller'], { selected: { seen: 'Not seen lately' } });
    expect(c.find((f) => f.key === 'seller')!.choices).toEqual([{ value: 'Dealer', count: 0 }, { value: 'Private', count: 1 }]);
    // Its own choice doesn't narrow its own counts.
    expect(c.find((f) => f.key === 'seen')!.choices).toEqual([{ value: 'Current', count: 3 }, { value: 'Not seen lately', count: 1 }]);
  });

  it("drops a chosen value nobody has any more, so a stale filter can't hide everything", () => {
    const c = filterChoices(cars, ['seen', 'seller']);
    expect(liveSelection({ seen: 'Not seen lately', seller: 'Auction' }, c)).toEqual({ seen: 'Not seen lately' });
  });

  it('is served for the grid to import', async () => {
    const res = await request(express().use(assetsRouter)).get('/assets/option-filters.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('export function filterChoices');
  });
});
