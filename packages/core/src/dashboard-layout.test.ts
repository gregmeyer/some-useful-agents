import { describe, it, expect } from 'vitest';
import { slugifyDashboardName, allocateUserDashboardId, mutateSections } from './dashboard-layout.js';
import type { DashboardLayout } from './dashboards-store.js';

describe('slugifyDashboardName', () => {
  it('lowercases and hyphenates punctuation runs', () => {
    expect(slugifyDashboardName('Markets & Crypto!')).toBe('markets-crypto');
  });
  it('trims leading/trailing hyphens', () => {
    expect(slugifyDashboardName('  --Hello--  ')).toBe('hello');
  });
  it('falls back to "dashboard" when nothing survives', () => {
    expect(slugifyDashboardName('!!!')).toBe('dashboard');
    expect(slugifyDashboardName('')).toBe('dashboard');
  });
  it('caps at 40 chars', () => {
    const long = 'a'.repeat(60);
    expect(slugifyDashboardName(long)).toHaveLength(40);
  });
});

describe('allocateUserDashboardId', () => {
  it('returns user:<slug> when free', () => {
    expect(allocateUserDashboardId('Markets', () => false)).toBe('user:markets');
  });
  it('appends a base-36 timestamp suffix on collision', () => {
    const id = allocateUserDashboardId('Markets', (cand) => cand === 'user:markets');
    expect(id).toMatch(/^user:markets-[a-z0-9]+$/);
    expect(id).not.toBe('user:markets');
  });
});

describe('mutateSections', () => {
  it('deep-copies sections and agentIds — input is untouched', () => {
    const layout: DashboardLayout = { sections: [{ title: 'A', agentIds: ['x'] }] };
    const out = mutateSections(layout, (arr) => {
      arr[0].agentIds.push('y');
      arr.push({ title: 'B', agentIds: ['z'] });
    });
    expect(out).toHaveLength(2);
    expect(out[0].agentIds).toEqual(['x', 'y']);
    // original untouched
    expect(layout.sections).toHaveLength(1);
    expect(layout.sections[0].agentIds).toEqual(['x']);
  });
});
