import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import express from 'express';
import { assetsRouter } from '../routes/assets.js';
import { optionNavIntent } from './notebook-chat.js';

// A browser module (assets/option-nav.js); a computed path keeps tsc from typing it.
const here = dirname(fileURLToPath(import.meta.url));
type Item = { id: string; stage?: string; notSeenLately: boolean; fields: Record<string, string> };
const { stepThrough } = await import(join(here, '..', 'assets', 'option-nav.js')) as {
  stepThrough: (order: Item[], id: string, filters: string[], sel: Record<string, string>) => { prev?: Item; next?: Item; pos?: number; count: number; filtered: boolean };
};

describe('"next" in an option page\'s talk box', () => {
  it('reads a message that only asks to move', () => {
    for (const t of ['next', 'Next!', 'open the next item in the detail list', "I'm done with this one, open the next", 'ok, go to the next one please', 'thanks. next listing', 'I’m done with it. show me the next option'])
      expect(optionNavIntent(t), t).toBe('next');
    for (const t of ['previous', 'go back to the previous one', 'prev']) expect(optionNavIntent(t), t).toBe('prev');
  });
  it('leaves anything more to sua', () => {
    for (const t of ['rule it out and open the next', 'is the next one cheaper?', 'what comes next for this one', 'next steps?', 'the next owner should know', ''])
      expect(optionNavIntent(t), t).toBeUndefined();
  });
});

describe('Previous / Next after the grid filters', () => {
  const order: Item[] = [
    { id: 'a', notSeenLately: false, fields: {} },
    { id: 'b', notSeenLately: true, fields: {} },
    { id: 'c', notSeenLately: false, fields: {} },
    { id: 'd', notSeenLately: true, fields: {} },
    { id: 'e', notSeenLately: false, fields: {} },
  ];
  it('steps through all of them with no filter', () => {
    expect(stepThrough(order, 'b', ['seen'], {})).toMatchObject({ prev: { id: 'a' }, next: { id: 'c' }, pos: 2, count: 5, filtered: false });
  });
  it('skips what the filters hide', () => {
    expect(stepThrough(order, 'c', ['seen'], { seen: 'Current' })).toMatchObject({ prev: { id: 'a' }, next: { id: 'e' }, pos: 2, count: 3, filtered: true });
    // A hidden one still steps to the nearest kept ones.
    const s = stepThrough(order, 'd', ['seen'], { seen: 'Current' });
    expect(s).toMatchObject({ prev: { id: 'c' }, next: { id: 'e' }, count: 3 });
    expect(s.pos).toBeUndefined();
  });
  it('ignores a choice that no longer exists', () => {
    expect(stepThrough(order, 'a', ['seen'], { seen: 'Gone' })).toMatchObject({ next: { id: 'b' }, filtered: false });
  });
  it('is served to the page', async () => {
    const res = await request(express().use(assetsRouter)).get('/assets/option-nav.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain("from './option-filters.js'");
  });
});
