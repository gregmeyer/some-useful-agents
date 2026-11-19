import { describe, it, expect } from 'vitest';
import type { Notebook, NotebookEntry } from '@some-useful-agents/core';
import { renderNotebookBrief } from './notebook-brief.js';

const at = '2026-11-10T00:00:00.000Z';
let n = 0;
const job = (company: string, title: string, over: Partial<NotebookEntry> = {}): NotebookEntry => ({
  id: `j${String(++n)}`, notebookId: 'nb', kind: 'option', title: `${company} · ${title}`, body: '', by: 'agent:x',
  data: { company, salary: 200 - n, url: `https://jobs.example.com/${company.toLowerCase().replace(/\W+/g, '-')}/${String(n)}` }, createdAt: at, ...over,
} as NotebookEntry);

// Fourteen in the running (12 in detail, the 2 highest-paid after them, since pay ranks lowest first), one ruled out; written up with a row that names five companies and cites one.
const companies = ['Omni', 'Taekus', 'CaptivateIQ', 'RapidSOS', 'ClickUp', 'Hims & Hers', 'Webflow', 'Human Interest', 'JLL', 'Everbridge', 'Blackbaud', 'Transfr', 'Thanx', 'ŌURA'];
const entries = [...companies.map((c) => job(c, 'Finance Manager')), job('Alteryx', 'Senior Financial Analyst', { ruledOut: { reason: 'Fails "Posting is still open"', at, by: 'agent:x' } } as Partial<NotebookEntry>)];
const id = (c: string) => entries.find((e) => (e.data as { company: string }).company === c)!.id;
const nb = {
  id: 'nb', title: 'Find jobs that fit', statement: 'Jobs', params: [], criteria: [], pipeline: [], stages: [], checks: [], cadence: '', status: 'active',
  fields: [{ key: 'salary', label: 'Salary', type: 'money', role: 'price' }, { key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'url', label: 'Link', type: 'url', role: 'link' }],
  steps: [{ id: 'w', kind: 'write', shape: 'writeup', label: 'Write up the field' }],
  answer: {
    text: 'Pursue Omni first.', confidence: 'medium', basis: '', at, open: [],
    findings: [{ text: 'Webflow, JLL and ŌURA sit below the target level.', from: [] }],
    sections: [
      { kind: 'table', title: 'The field in groups', columns: ['Group', 'Which'], rows: [{ cells: ['Below the target level', 'Hims & Hers, Webflow, Human Interest, JLL, Everbridge'], from: [id('Hims & Hers')] }, { cells: ['Checked', 'Omni'], from: [id('Omni')] }] },
      { kind: 'steps', title: 'What to do next', items: [{ text: 'Apply to Omni.', from: [id('Omni')] }, { text: 'Check Thanx.', from: [] }] },
    ],
  },
  createdAt: at, updatedAt: at,
} as unknown as Notebook;

describe("a brief's links", () => {
  const out = renderNotebookBrief({ nb, entries, now: new Date(at) });
  const notes = out.slice(out.indexOf('Source notes'));

  it('a group the write-up names cites each company in it, not only the ones the writer cited', () => {
    for (const c of ['hims-hers', 'webflow', 'human-interest', 'jll', 'everbridge', 'thanx', '-ura']) expect(notes).toContain(`jobs.example.com/${c}/`);
    // A step keeps its number beside its words.
    expect(out).toMatch(/<li><span><b>Apply to Omni\.<\/b><sup class="note">/);
  });

  it('the options past the twelve in detail, and the ruled out, link to their own pages', () => {
    const more = out.slice(out.indexOf('Also in the running:'));
    expect(more).toContain('<a class="tbl__link" href="https://jobs.example.com/taekus/2"');
    expect(out.slice(out.indexOf('b-out'))).toContain('<a class="tbl__link" href="https://jobs.example.com/alteryx/15"');
  });
});
