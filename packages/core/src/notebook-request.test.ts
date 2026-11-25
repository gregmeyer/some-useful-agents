import { describe, it, expect } from 'vitest';
import { describeNotebookTemplate, templatesForAsk } from './notebook-request.js';
import type { NotebookTemplate, NotebookTemplateSetup } from './notebooks.js';

const setup = (s: Partial<NotebookTemplateSetup>): NotebookTemplateSetup => ({
  statement: '', params: [], criteria: [], fields: [], checks: [], stages: [], steps: [], cadence: '', pipeline: [], ...s,
});
const template = (id: string, name: string, s: Partial<NotebookTemplateSetup>, uses = 0): NotebookTemplate => ({
  id, name, description: '', setup: setup(s), uses, createdAt: '2026-11-01', updatedAt: '2026-11-01',
});

// Shaped like the person's own: a meeting briefing (its own page), a company briefing, buying, a job search.
const meeting = template('meeting-briefing', 'Meeting briefing', {
  statement: 'Prepare sourced talking points and questions for my meeting with {subject}, from their profile and relevant public sources.',
  steps: [{ id: 's1', title: 'Learn about {subject}', kind: 'profile', status: 'todo', tries: 0 }, { id: 's2', title: 'Write talking points', kind: 'write', status: 'todo', tries: 0 }],
  layout: { preset: 'dossier', components: [] },
  subject: { label: "Who you're meeting (a person or company)", example: 'Alan Berkson' },
  asks: [{ label: "{subject}'s LinkedIn profile", optional: true }],
}, 3);
const company = template('company-briefing', 'Company briefing', {
  statement: 'Create a company briefing for {subject}.',
  steps: [{ id: 's1', title: 'Learn about {subject}', kind: 'profile', status: 'todo', tries: 0 }, { id: 's2', title: 'Find 5 sources on {subject}', kind: 'find', status: 'todo', tries: 0 }],
  subject: { label: 'The company (its name, and website if you have it)', example: 'Arrive' },
}, 2);
const buy = template('buy-something', 'Buy something', { statement: 'Find {subject} at a fair price from a seller I can trust, and decide which to buy.', subject: { label: "What you're buying", example: 'a used set of Sonos speakers' } });
const jobs = template('job-search', 'Job search', { statement: 'Find the best currently open {subject} that fit where I want to work, my level and my pay floor.', subject: { label: "The role you're looking for", example: 'Staff+ PM roles' } });
const all = [meeting, company, buy, jobs];

describe('templatesForAsk', () => {
  it('suggests the template of the same kind', () => {
    expect(templatesForAsk('Prep me for my call with Dana Reyes at Duolingo on Friday', all).map((t) => t.id)).toEqual(['meeting-briefing']);
    expect(templatesForAsk('Tell me about Duolingo, duolingo.com', all).map((t) => t.id)).toEqual(['company-briefing']);
    expect(templatesForAsk('I want to buy a used Subaru Outback', all).map((t) => t.id)).toEqual(['buy-something']);
    expect(templatesForAsk('Find me a staff PM job in Seattle', all).map((t) => t.id)).toEqual(['job-search']);
  });
  it('suggests nothing when no template is that kind, or the ask says nothing of its kind', () => {
    expect(templatesForAsk('Plan a week in Lisbon in May', all)).toEqual([]);
    expect(templatesForAsk('Duolingo', all)).toEqual([]);
    expect(templatesForAsk('Compare standing desks under $600', all)).toEqual([]);
    expect(templatesForAsk('Tell me about Duolingo', [{ ...company, archivedAt: '2026-11-02' }])).toEqual([]);
  });
});

describe('describeNotebookTemplate', () => {
  it('says what it is for, its steps, its page and what it needs', () => {
    expect(describeNotebookTemplate(meeting)).toBe([
      '- meeting-briefing: Meeting briefing',
      '  For: Prepare sourced talking points and questions for my meeting with <subject>, from their profile and relevant public sources.',
      '  Steps: Learn about <subject> → Write talking points',
      '  Page: Meeting brief',
      `  Subject: Who you're meeting (a person or company), e.g. "Alan Berkson"`,
      "  Asks the person for: <subject>'s LinkedIn profile",
    ].join('\n'));
    expect(describeNotebookTemplate(company)).toContain('  Page: chosen when it’s made, to fit what it’s for');
  });
});
