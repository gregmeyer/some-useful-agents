import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlockedImgHostsStore, isValidImgHost } from './blocked-img-hosts-store.js';

let dir: string;
let store: BlockedImgHostsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-blocked-img-hosts-'));
  store = new BlockedImgHostsStore(join(dir, 'runs.db'));
});

afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('isValidImgHost', () => {
  it.each([
    ['apod.nasa.gov', true],
    ['cdn.example.com', true],
    ['CDN.Example.Com', true],
    ['images.unsplash.com:8443', true],
    ['x.y', true],
  ])('accepts %s', (host, expected) => {
    expect(isValidImgHost(host)).toBe(expected);
  });

  it.each([
    [''],
    ['no-tld'],
    ['https://example.com'],
    ['example.com/path'],
    ['example.com?q=1'],
    ['127.0.0.1'],
    ['a'.repeat(300) + '.com'],
    ['has space.com'],
    ['<script>alert(1)</script>'],
  ])('rejects %s', (host) => {
    expect(isValidImgHost(host)).toBe(false);
  });
});

describe('BlockedImgHostsStore', () => {
  it('returns empty list when no blocks recorded', () => {
    expect(store.listForAgent('astro')).toEqual([]);
  });

  it('records one block, lower-cases the host, and increments count on repeats', () => {
    const first = store.record('astro', 'APOD.nasa.gov');
    expect(first).not.toBeNull();
    expect(first?.host).toBe('apod.nasa.gov');
    expect(first?.count).toBe(1);
    expect(first?.lastSeenAt).toBeGreaterThan(0);

    const second = store.record('astro', 'apod.nasa.gov');
    expect(second?.count).toBe(2);
    expect((second?.lastSeenAt ?? 0) >= (first?.lastSeenAt ?? 0)).toBe(true);
  });

  it('rejects invalid hosts and returns null without writing', () => {
    expect(store.record('astro', 'not a host')).toBeNull();
    expect(store.record('astro', '')).toBeNull();
    expect(store.record('astro', 'https://example.com')).toBeNull();
    expect(store.listForAgent('astro')).toEqual([]);
  });

  it('rejects empty agentId', () => {
    expect(store.record('', 'apod.nasa.gov')).toBeNull();
  });

  it('lists per agent, capped at limit, scoped to one agent', async () => {
    // Date.now() granularity means same-millisecond inserts tie on
    // last_seen_at; sleep between inserts so the newest-first ordering
    // is deterministic.
    store.record('astro', 'a.example.com');
    await new Promise((r) => setTimeout(r, 5));
    store.record('astro', 'b.example.com');
    await new Promise((r) => setTimeout(r, 5));
    store.record('astro', 'c.example.com');
    store.record('weather', 'w.example.com');

    const astro = store.listForAgent('astro');
    expect(astro.map((h) => h.host)).toEqual(['c.example.com', 'b.example.com', 'a.example.com']);

    const weather = store.listForAgent('weather');
    expect(weather.map((h) => h.host)).toEqual(['w.example.com']);

    const limited = store.listForAgent('astro', 2);
    expect(limited).toHaveLength(2);
  });

  it('deleteFor removes a single host', () => {
    store.record('astro', 'a.example.com');
    store.record('astro', 'b.example.com');
    store.deleteFor('astro', 'a.example.com');
    expect(store.listForAgent('astro').map((h) => h.host)).toEqual(['b.example.com']);
  });

  it('clearForAgent removes every entry for one agent only', () => {
    store.record('astro', 'a.example.com');
    store.record('astro', 'b.example.com');
    store.record('weather', 'w.example.com');
    store.clearForAgent('astro');
    expect(store.listForAgent('astro')).toEqual([]);
    expect(store.listForAgent('weather')).toHaveLength(1);
  });
});
