import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LayoutHintsStore } from './layout-hints-store.js';

let dir: string;
let store: LayoutHintsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-layout-hints-store-'));
  store = new LayoutHintsStore(join(dir, 'hints.db'));
});

afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('LayoutHintsStore', () => {
  it('returns null for an agent with no hint', () => {
    expect(store.getHint('nope')).toBeNull();
  });

  it('sets and reads a hint with all three fields', () => {
    store.setHint('api-monitor', { size: '2x1', tileFit: 'scroll', height: 240 });
    const hint = store.getHint('api-monitor');
    expect(hint).not.toBeNull();
    expect(hint?.size).toBe('2x1');
    expect(hint?.tileFit).toBe('scroll');
    expect(hint?.height).toBe(240);
    expect(hint?.updatedAt).toBeGreaterThan(0);
  });

  it('patches one field without touching others', () => {
    store.setHint('weather', { size: '1x1', tileFit: 'grow' });
    store.setHint('weather', { height: 180 });
    const hint = store.getHint('weather');
    expect(hint?.size).toBe('1x1');
    expect(hint?.tileFit).toBe('grow');
    expect(hint?.height).toBe(180);
  });

  it('clears a field when patched with null', () => {
    store.setHint('weather', { size: '1x1', tileFit: 'grow', height: 180 });
    store.setHint('weather', { height: null });
    const hint = store.getHint('weather');
    expect(hint?.size).toBe('1x1');
    expect(hint?.tileFit).toBe('grow');
    expect(hint?.height).toBeUndefined();
  });

  it('deletes the row entirely when every field is cleared', () => {
    store.setHint('weather', { size: '1x1', tileFit: 'grow', height: 180 });
    store.setHint('weather', { size: null, tileFit: null, height: null });
    expect(store.getHint('weather')).toBeNull();
  });

  it('bulk-reads hints for a list of agent ids', () => {
    store.setHint('a', { size: '1x1' });
    store.setHint('b', { tileFit: 'scroll' });
    store.setHint('c', { height: 200 });
    const map = store.getHintsFor(['a', 'b', 'missing']);
    expect(map.size).toBe(2);
    expect(map.get('a')?.size).toBe('1x1');
    expect(map.get('b')?.tileFit).toBe('scroll');
    expect(map.has('missing')).toBe(false);
  });

  it('deleteForAgent removes a single row', () => {
    store.setHint('a', { size: '1x1' });
    store.setHint('b', { size: '2x1' });
    store.deleteForAgent('a');
    expect(store.getHint('a')).toBeNull();
    expect(store.getHint('b')?.size).toBe('2x1');
  });

  it('clear removes all rows', () => {
    store.setHint('a', { size: '1x1' });
    store.setHint('b', { size: '2x1' });
    store.clear();
    expect(store.listAll()).toEqual([]);
  });

  it('rejects an invalid size', () => {
    expect(() => store.setHint('a', { size: '5x5' as never })).toThrow(/invalid size/);
  });

  it('rejects an invalid tileFit', () => {
    expect(() => store.setHint('a', { tileFit: 'shrink' as never })).toThrow(/invalid tileFit/);
  });

  it('rejects out-of-range or non-integer heights', () => {
    expect(() => store.setHint('a', { height: 40 })).toThrow(/out of range/);
    expect(() => store.setHint('a', { height: 5000 })).toThrow(/out of range/);
    expect(() => store.setHint('a', { height: 240.5 })).toThrow(/out of range/);
  });

  it('requires a non-empty agentId', () => {
    expect(() => store.setHint('', { size: '1x1' })).toThrow(/agentId is required/);
  });
});
