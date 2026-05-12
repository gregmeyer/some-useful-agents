import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntegrationsStore } from './integrations-store.js';

let dir: string;
let store: IntegrationsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-integrations-store-'));
  store = new IntegrationsStore(join(dir, 'runs.db'));
});

afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('IntegrationsStore', () => {
  it('upserts and retrieves an integration', () => {
    store.upsertIntegration({
      id: 'user:oncall-slack',
      packId: null,
      kind: 'slack',
      name: 'Oncall Slack',
      config: { channel: '#alerts' },
      secretRefs: ['SLACK_WEBHOOK'],
    });
    const got = store.getIntegration('user:oncall-slack');
    expect(got).not.toBeNull();
    expect(got!.kind).toBe('slack');
    expect(got!.name).toBe('Oncall Slack');
    expect(got!.config).toEqual({ channel: '#alerts' });
    expect(got!.secretRefs).toEqual(['SLACK_WEBHOOK']);
    expect(got!.packId).toBeNull();
    expect(typeof got!.createdAt).toBe('number');
    expect(got!.updatedAt).toBe(got!.createdAt);
  });

  it('preserves createdAt + bumps updatedAt on update', async () => {
    store.upsertIntegration({
      id: 'user:oncall-slack',
      packId: null,
      kind: 'slack',
      name: 'Oncall Slack',
      config: { channel: '#alerts' },
      secretRefs: ['SLACK_WEBHOOK'],
    });
    const initial = store.getIntegration('user:oncall-slack')!;
    await new Promise((r) => setTimeout(r, 5));
    store.upsertIntegration({
      id: 'user:oncall-slack',
      packId: null,
      kind: 'slack',
      name: 'Oncall Slack (renamed)',
      config: { channel: '#oncall' },
      secretRefs: ['SLACK_WEBHOOK'],
    });
    const updated = store.getIntegration('user:oncall-slack')!;
    expect(updated.createdAt).toBe(initial.createdAt);
    expect(updated.updatedAt).toBeGreaterThan(initial.updatedAt);
    expect(updated.name).toBe('Oncall Slack (renamed)');
    expect(updated.config).toEqual({ channel: '#oncall' });
  });

  it('rejects ids that violate the slug regex', () => {
    expect(() =>
      store.upsertIntegration({
        id: 'NotLowercase',
        packId: null,
        kind: 'slack',
        name: 'x',
        config: {},
        secretRefs: [],
      }),
    ).toThrow(/Invalid integration id/);
    expect(() =>
      store.upsertIntegration({
        id: 'spaces not allowed',
        packId: null,
        kind: 'slack',
        name: 'x',
        config: {},
        secretRefs: [],
      }),
    ).toThrow(/Invalid integration id/);
  });

  it('lists by kind + by user, ordered by name', () => {
    store.upsertIntegration({ id: 'user:b-webhook', packId: null, kind: 'webhook', name: 'B Webhook', config: { url: 'https://b.example.com' }, secretRefs: [] });
    store.upsertIntegration({ id: 'user:a-slack', packId: null, kind: 'slack', name: 'A Slack', config: { channel: '#a' }, secretRefs: ['SLACK_A'] });
    store.upsertIntegration({ id: 'starter:notify', packId: 'starter', kind: 'webhook', name: 'C Webhook (pack)', config: { url: 'https://c.example.com' }, secretRefs: [] });

    expect(store.listIntegrations().map((i) => i.id)).toEqual(['user:a-slack', 'user:b-webhook', 'starter:notify']);
    expect(store.listByKind('webhook').map((i) => i.id)).toEqual(['user:b-webhook', 'starter:notify']);
    expect(store.listUserIntegrations().map((i) => i.id)).toEqual(['user:a-slack', 'user:b-webhook']);
  });

  it('returns null for unknown id', () => {
    expect(store.getIntegration('user:nope')).toBeNull();
  });

  it('deletes a single integration and reports the result', () => {
    store.upsertIntegration({ id: 'user:x', packId: null, kind: 'slack', name: 'X', config: {}, secretRefs: [] });
    expect(store.deleteIntegration('user:x')).toBe(true);
    expect(store.getIntegration('user:x')).toBeNull();
    expect(store.deleteIntegration('user:x')).toBe(false);
  });

  it('cascades pack-owned deletes via deleteByPack', () => {
    store.upsertIntegration({ id: 'starter:a', packId: 'starter', kind: 'slack', name: 'A', config: {}, secretRefs: [] });
    store.upsertIntegration({ id: 'starter:b', packId: 'starter', kind: 'file', name: 'B', config: { path: 'out.log' }, secretRefs: [] });
    store.upsertIntegration({ id: 'user:keep', packId: null, kind: 'slack', name: 'Keep', config: {}, secretRefs: [] });

    const removed = store.deleteByPack('starter');
    expect(removed).toBe(2);
    expect(store.listIntegrations().map((i) => i.id)).toEqual(['user:keep']);
  });

  it('survives malformed JSON in legacy rows by defaulting', () => {
    // Sneak a row in with broken JSON to make sure rowToIntegration doesn't crash.
    const dbPath = join(dir, 'runs.db');
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(dbPath);
    const now = Date.now();
    raw.prepare(`
      INSERT INTO integrations (id, pack_id, kind, name, config_json, secret_refs_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('user:broken', null, 'slack', 'Broken', '{not json', '[not json', now, now);
    raw.close();

    const got = store.getIntegration('user:broken');
    expect(got).not.toBeNull();
    expect(got!.config).toEqual({});
    expect(got!.secretRefs).toEqual([]);
  });
});
