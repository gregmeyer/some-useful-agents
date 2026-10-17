import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { AgentCatalogStore, agentCatalogKey, CATALOG_RETRY_MS } from './agent-catalog-store.js';

const a = (id: string, description = 'does a thing') => ({ id, name: id, description, version: 1 });

describe('AgentCatalogStore', () => {
  it('keeps each agent group and use-it-for line, and lists groups biggest first', () => {
    const store = AgentCatalogStore.fromHandle(new DatabaseSync(':memory:'));
    store.save([
      { agent: a('ashby'), group: 'Jobs & companies', useFor: 'Find roles' },
      { agent: a('lever'), group: 'Jobs & companies' },
      { agent: a('news'), group: 'News & digests', useFor: 'Morning news' },
    ]);
    const all = store.all();
    expect(all.get('ashby')).toMatchObject({ group: 'Jobs & companies', useFor: 'Find roles' });
    expect(all.get('lever')?.useFor).toBeUndefined();
    expect(store.groups()).toEqual(['Jobs & companies', 'News & digests']);
  });

  it('an agent is stale when new or changed, not when it is unchanged', () => {
    const store = AgentCatalogStore.fromHandle(new DatabaseSync(':memory:'));
    store.save([{ agent: a('ashby'), group: 'Jobs & companies' }]);
    expect(store.stale([a('ashby'), a('news')]).map((x) => x.id)).toEqual(['news']);
    expect(store.stale([a('ashby', 'now reads salaries too')]).map((x) => x.id)).toEqual(['ashby']);
    expect(agentCatalogKey(a('ashby'))).not.toBe(agentCatalogKey({ ...a('ashby'), version: 2 }));
  });

  it('a failed sort waits before it is tried again, and keeps an earlier group', () => {
    const store = AgentCatalogStore.fromHandle(new DatabaseSync(':memory:'));
    store.save([{ agent: a('ashby'), group: 'Jobs & companies' }]);
    const now = new Date('2026-10-16T12:00:00Z');
    store.markFailed([a('ashby', 'changed'), a('news')], now);
    expect(store.stale([a('ashby', 'changed'), a('news')], now.getTime() + 1000)).toEqual([]);
    expect(store.stale([a('ashby', 'changed'), a('news')], now.getTime() + CATALOG_RETRY_MS + 1).map((x) => x.id)).toEqual(['ashby', 'news']);
    expect(store.all().get('ashby')?.group).toBe('Jobs & companies');
    expect(store.all().has('news')).toBe(false);
  });
});
