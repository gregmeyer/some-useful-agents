import { describe, it, expect } from 'vitest';
import { starterView, humanizeName } from './starter.js';
import { validateViewComponents } from './view.js';

describe('starter view', () => {
  it('turns real outputs into metrics, a trend, labelled lines, a table and chips, and validates', () => {
    const comps = starterView({
      outputs: { stars: '1,300', forks: 40, repo: 'acme/widgets', issues: [{ title: 'Bug', state: 'open' }], tags: ['ts', 'cli'], summary: 'x'.repeat(200), empty: '' },
      series: { stars: [1100, 1200, 1300] },
      labels: { repo: 'Repository' },
    });
    expect(validateViewComponents(comps).ok).toBe(true);
    const by = (id: string) => comps.find((c) => c.id === id)!;
    expect(by('root').children).toEqual(['metrics', 'o_stars_trend', 'facts', 'o_issues', 'o_tags', 'o_summary']);
    expect(by('metrics').children).toEqual(['o_stars', 'o_forks']);
    expect(by('o_stars_trend')).toMatchObject({ component: 'Sparkline', values: { path: '/series/stars' } });
    expect(by('o_repo_l').text).toBe('Repository');
    expect(by('o_issues_t')).toMatchObject({ component: 'Table', columns: [{ key: 'title', label: 'Title' }, { key: 'state', label: 'State' }] });
    expect(by('o_tags_c')).toMatchObject({ component: 'ChipList', items: { path: '/outputs/tags' } });
    expect(comps.some((c) => c.id === 'o_empty')).toBe(false);
  });

  it('shows the result text when a run has no structured outputs', () => {
    const comps = starterView({ outputs: {} });
    expect(validateViewComponents(comps).ok).toBe(true);
    expect(comps.find((c) => c.id === 'result')).toMatchObject({ text: { path: '/result' } });
  });

  it('humanizes output names', () => {
    expect(humanizeName('issue_count')).toBe('Issue count');
    expect(humanizeName('openPRs')).toBe('Open prs');
  });
});

describe('starter view from a step that printed JSON', () => {
  it('uses the fields, not the raw result text, and links URL columns', () => {
    const comps = starterView({ outputs: { articles: [{ title: 'A', url: 'https://a.example' }], count: 5, result: '{"articles":[]}' } });
    expect(comps.some((c) => c.id === 'o_result')).toBe(false);
    expect(comps.find((c) => c.id === 'o_articles_t')!.columns).toEqual([{ key: 'title', label: 'Title' }, { key: 'url', label: 'Url', format: 'link', linkText: 'title' }]);
  });
});
