import { describe, it, expect } from 'vitest';
import { layoutPreset, type NotebookStep } from '@some-useful-agents/core';
import { notebookToMarkdown, notebookFromMarkdown, describeSetupChange, keepStepProgress, pageName, ABOUT_THE_PAGE, type NotebookSetup } from './notebook-edit.js';

const step = (id: string, title: string, kind: NotebookStep['kind'], extra: Partial<NotebookStep> = {}): NotebookStep => ({ id, title, kind, status: 'todo', tries: 0, ...extra });

const SETUP: NotebookSetup = {
  title: 'Prepare for a meeting with Dana Reyes', statement: 'What matters to Dana before our call',
  params: ['30 minutes'], criteria: ['Talking points chosen', 'Questions ready'], met: { 'Talking points chosen': true, 'Questions ready': false },
  fields: [
    { key: 'theme', label: 'Theme', type: 'text' },
    { key: 'evidence', label: 'What she said', type: 'text', role: 'quote' },
    { key: 'price', label: 'Fee', type: 'money', role: 'price', better: 'lower', unit: 'usd' },
  ],
  checks: ['Said in the last year'], stages: ['Found', 'Checked'], pipeline: ['research-one'], cadence: '',
  steps: [
    step('s1', 'Learn about Dana Reyes', 'profile', { subject: 'Dana Reyes', status: 'done', tries: 1, doneAt: '2026-10-20T00:00:00Z' }),
    step('s2', 'Find what Dana has said', 'find', { target: 5, agentId: 'research-one', status: 'running', tries: 2 }),
    step('s3', 'Source the facts', 'source', { facts: ['evidence', 'theme'], top: 5 }),
  ],
};
const AGENTS = new Set(['research-one', 'notebook-finder']);

describe('a notebook as a document', () => {
  it('writes every part of its setup, and reads it back as it was', () => {
    const md = notebookToMarkdown(SETUP, undefined);
    expect(md).toContain('# Prepare for a meeting with Dana Reyes\n\nWhat matters to Dana before our call');
    expect(md).toContain('- [x] Talking points chosen\n- [ ] Questions ready');
    expect(md).toContain('- Fee: money in usd, price, lower is better');
    expect(md).toContain('1. Learn about Dana Reyes (profile; about Dana Reyes)');
    expect(md).toContain('2. Find what Dana has said (find 5; with research-one)');
    expect(md).toContain('3. Source the facts (source; facts evidence, theme; top 5)');
    expect(md).toContain('Found → Checked');
    expect(md).toContain('## How it looks\nShortlist');
    const back = notebookFromMarkdown(md, SETUP, undefined, AGENTS);
    expect('error' in back ? back.error : back.setup).toEqual(SETUP);
    expect('layout' in back).toBe(false);
  });

  it('takes what you changed, keeps how far kept steps got, and leaves a section you left out as it was', () => {
    const md = notebookToMarkdown(SETUP, undefined)
      .replace('# Prepare for a meeting with Dana Reyes', '# Meet Dana Reyes')
      .replace('- 30 minutes', '- 45 minutes\n- over video')
      .replace('- [ ] Questions ready', '- [x] Questions ready')
      .replace('- Fee: money in usd, price, lower is better\n', '- Company: text, org\n')
      .replace('3. Source the facts (source; facts evidence, theme; top 5)', '3. Write the talking points (decide 3)\n4. Source the facts (source; facts evidence, theme; top 5)')
      .replace(/## Checks\n[^#]*/, '')
      .replace('## How it looks\nShortlist', '## How it looks\nMeeting briefing');
    const back = notebookFromMarkdown(md, SETUP, undefined, AGENTS);
    if ('error' in back) throw new Error(back.error);
    expect(back.setup.title).toBe('Meet Dana Reyes');
    expect(back.setup.params).toEqual(['45 minutes', 'over video']);
    expect(back.setup.met).toEqual({ 'Talking points chosen': true, 'Questions ready': true });
    expect(back.setup.fields.map((f) => [f.key, f.role])).toEqual([['theme', undefined], ['evidence', 'quote'], ['company', 'org']]);
    expect(back.setup.checks).toEqual(['Said in the last year']);
    expect(back.setup.steps.map((s) => [s.id, s.title, s.status])).toEqual([
      ['s1', 'Learn about Dana Reyes', 'done'], ['s2', 'Find what Dana has said', 'running'], ['s4', 'Write the talking points', 'todo'], ['s3', 'Source the facts', 'todo'],
    ]);
    expect(back.layout).toEqual(layoutPreset('dossier')!.layout);
    // A document from before, with "## Page", reads the same.
    const older = notebookFromMarkdown(md.replace('## How it looks', '## Page'), SETUP, undefined, AGENTS);
    expect('layout' in older && older.layout).toEqual(layoutPreset('dossier')!.layout);
    expect(describeSetupChange(SETUP, back.setup, undefined, back.layout)).toEqual([
      'Title: “Prepare for a meeting with Dana Reyes” → “Meet Dana Reyes”',
      'Added the limit “45 minutes”', 'Added the limit “over video”', 'Removed the limit “30 minutes”',
      'Notes a new fact: Company (text, org)', 'No longer notes Fee',
      'Added step 3: Write the talking points (decide 3)',
      'How it looks: Shortlist → Meeting briefing',
    ]);
  });

  it('says what it needs: a title, and a schedule it understands', () => {
    expect(notebookFromMarkdown('no title here', SETUP, undefined, AGENTS)).toEqual({ error: expect.stringContaining('It needs a title') });
    expect(notebookFromMarkdown(notebookToMarkdown(SETUP, undefined).replace('Schedule: when you ask', 'Schedule: whenever'), SETUP, undefined, AGENTS)).toEqual({ error: expect.stringContaining('"whenever" isn\'t a schedule') });
    const daily = notebookFromMarkdown(notebookToMarkdown(SETUP, undefined).replace('Schedule: when you ask', 'Schedule: 0 7 * * *'), SETUP, undefined, AGENTS);
    expect('setup' in daily && daily.setup.cadence).toBe('0 7 * * *');
  });
});

describe('what an edit changes', () => {
  it('a step with the same title is the same step; one in the same place with the same kind is too', () => {
    const was = SETUP.steps;
    const kept = keepStepProgress(was, [{ title: 'Find what she has said', kind: 'find', target: 8 }, { title: 'Learn about Dana Reyes', kind: 'profile', subject: 'Dana Reyes' }]);
    // The profile step moved second and kept how far it got; the find step in first place (a profile step was there) is new.
    expect(kept.map((s) => [s.id, s.title, s.status])).toEqual([['s2', 'Find what she has said', 'todo'], ['s1', 'Learn about Dana Reyes', 'done']]);
    expect(kept[0].target).toBe(8);
    const renamed = keepStepProgress(was, [{ title: 'Learn about Dana', kind: 'profile' }, { title: 'Find her talks', kind: 'find', target: 5 }]);
    expect(renamed.map((s) => [s.id, s.status])).toEqual([['s1', 'done'], ['s2', 'running']]);
  });

  it('names the page: a ready-made one, the shortlist, or one drawn for it', () => {
    expect(pageName(undefined)).toBe('Shortlist');
    expect(pageName(layoutPreset('dossier')!.layout)).toBe('Meeting briefing');
    expect(pageName({ components: [], about: 'a report' })).toBe('Made for this notebook');
  });

  it('knows a request about the page from one about the work', () => {
    expect(ABOUT_THE_PAGE.test('put who she is at the top')).toBe(true);
    expect(ABOUT_THE_PAGE.test('make it a report')).toBe(true);
    expect(ABOUT_THE_PAGE.test('add a step to learn about her company')).toBe(false);
  });
});
