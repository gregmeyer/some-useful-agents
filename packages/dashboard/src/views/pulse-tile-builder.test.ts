import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LayoutHintsStore, type Agent, type AgentSignal } from '@some-useful-agents/core';
import { attachLayoutHints } from './pulse-tile-builder.js';
import type { PulseTile } from './pulse-types.js';

let dir: string;
let store: LayoutHintsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-attach-hints-'));
  store = new LayoutHintsStore(join(dir, 'hints.db'));
});

afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function tile(id: string): PulseTile {
  const signal = { title: id, template: 'text-headline' } as AgentSignal;
  return {
    agent: { id, name: id, status: 'active', signal } as Agent,
    signal,
    slots: {},
  };
}

describe('attachLayoutHints', () => {
  it('decorates tiles whose agent has a hint', () => {
    store.setHint('a', { size: '2x1', tileFit: 'scroll' });
    const tiles = [tile('a'), tile('b')];
    attachLayoutHints(tiles, store);
    expect(tiles[0].layoutHint?.size).toBe('2x1');
    expect(tiles[0].layoutHint?.tileFit).toBe('scroll');
    expect(tiles[1].layoutHint).toBeUndefined();
  });

  it('skips system tiles entirely', () => {
    store.setHint('_system-runs-today', { size: '1x1' });
    const tiles = [tile('_system-runs-today')];
    attachLayoutHints(tiles, store);
    expect(tiles[0].layoutHint).toBeUndefined();
  });

  it('is a no-op when the store is undefined', () => {
    const tiles = [tile('a')];
    expect(() => attachLayoutHints(tiles, undefined)).not.toThrow();
    expect(tiles[0].layoutHint).toBeUndefined();
  });

  it('is a no-op on an empty tiles list', () => {
    expect(() => attachLayoutHints([], store)).not.toThrow();
  });
});
