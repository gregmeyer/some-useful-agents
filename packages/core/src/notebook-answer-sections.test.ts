import { describe, it, expect } from 'vitest';
import { cleanAnswer, criterionLink, criterionMet, notebookAmounts, answerSectionLines, type Notebook } from './notebooks.js';
import { withAnswerSections, layoutPreset, resolveNotebookLayout } from './notebook-layout.js';
import { notebookReadoutJson, notebookReadoutText } from './notebook-readout.js';

// An answer can carry the parts it was asked for: the steps to take, a rubric, a short explanation.
const ids = new Set(['a', 'b']);
const criteria = ['A sourced explanation of how a CD ladder works', 'A simple decision rubric written for the $25,000'];

describe('answer sections', () => {
  it('keeps the steps, tables and text that hold, cut to size, citing only what it can', () => {
    const a = cleanAnswer({
      answer: 'Split it into **five CDs**.', confidence: 'medium', findings: [],
      sections: [
        { kind: 'table', title: 'Rubric', delivers: 'a simple decision rubric written for the $25,000', columns: ['If…', 'Then…', 'Why', '', 'x', 'y'], rows: [{ cells: ['You need it within a year', 'A no-penalty CD', 'No penalty to take it out', 'extra'], from: ['a', 'made-up'] }, ['Not for 2 years', '24-month CD']] },
        { kind: 'steps', title: 'Open the ladder', items: ['Check each bank is insured', { text: 'Open five CDs', detail: '$5,000 each', from: ['b'] }] },
        { kind: 'steps', title: 'Too short', items: ['Only one'] },
        { kind: 'diagram', title: 'Not yet' },
        { kind: 'text', title: 'How it works', body: 'Each CD comes due a year apart.' },
        { kind: 'text', title: 'A second text', body: 'dropped' },
        { kind: 'table', title: 'Says it gives one the notebook does not have', delivers: 'A made-up done-when', columns: ['A', 'B'], rows: [['1', '2']] },
      ],
    }, ids, 'q', 'notebook-writer', 'x', { criteria })!;
    expect(a.sections).toEqual([
      {
        kind: 'table', title: 'Rubric', delivers: 'A simple decision rubric written for the $25,000', columns: ['If…', 'Then…', 'Why', 'x', 'y'],
        rows: [{ cells: ['You need it within a year', 'A no-penalty CD', 'No penalty to take it out', 'extra', ''], from: ['a'] }, { cells: ['Not for 2 years', '24-month CD', '', '', ''], from: [] }],
      },
      { kind: 'steps', title: 'Open the ladder', items: [{ text: 'Check each bank is insured', from: [] }, { text: 'Open five CDs', detail: '$5,000 each', from: ['b'] }] },
      { kind: 'text', title: 'How it works', body: 'Each CD comes due a year apart.' },
      { kind: 'table', title: 'Says it gives one the notebook does not have', columns: ['A', 'B'], rows: [{ cells: ['1', '2'], from: [] }] },
    ]);
    // No sections: none kept.
    expect(cleanAnswer({ answer: 'Yes.', findings: [] }, ids, 'q', 'w')).not.toHaveProperty('sections');
  });

  it('a rubric written ticks itself in a notebook that ends in an answer, and still waits for a decision in a shortlist', () => {
    const answerNb = { checks: [], steps: [{ id: 's', title: 'Write', kind: 'write', shape: 'answer' }] } as unknown as Notebook;
    const shortlist = { checks: [], steps: [{ id: 's', title: 'Decide', kind: 'decide' }] } as unknown as Notebook;
    expect(criterionLink(answerNb, 'A simple decision rubric written for the $25,000')).toEqual({ kind: 'written', what: 'table' });
    expect(criterionLink(answerNb, 'Steps to open the accounts written')).toEqual({ kind: 'written', what: 'steps' });
    expect(criterionLink(answerNb, 'A decision recorded')).toEqual({ kind: 'decide' });
    expect(criterionLink(shortlist, 'A simple decision rubric written for the $25,000')).toEqual({ kind: 'decide' });

    const nb = { ...answerNb, status: 'active', criteria: [], fields: [], answer: { question: 'q', text: 'x', confidence: 'low', findings: [], open: [], at: 'x', by: 'w' } } as unknown as Notebook;
    expect(criterionMet(nb, [], 'A simple decision rubric written for the $25,000')).toBe(false);
    const withTable = { ...nb, answer: { ...nb.answer!, sections: [{ kind: 'table', title: 'R', columns: ['a', 'b'], rows: [{ cells: ['1', '2'], from: [] }] }] } } as Notebook;
    expect(criterionMet(withTable, [], 'A simple decision rubric written for the $25,000')).toBe(true);
    expect(criterionMet(withTable, [], 'Steps to open the accounts written')).toBe(false);
    // The part that says it gives one ticks it, whatever its kind.
    const says = { ...nb, answer: { ...nb.answer!, sections: [{ kind: 'text', title: 'T', body: 'b', delivers: 'Steps to open the accounts written' }] } } as Notebook;
    expect(criterionMet(says, [], 'Steps to open the accounts written')).toBe(true);
    // However it's worded: "compared" isn't "written", but the part says it gives it.
    const compared = { ...nb, answer: { ...nb.answer!, sections: [{ kind: 'table', title: 'Terms', columns: ['a', 'b'], rows: [{ cells: ['1', '2'], from: [] }], delivers: 'Account terms and tradeoffs compared' }] } } as Notebook;
    expect(criterionMet(compared, [], 'Account terms and tradeoffs compared')).toBe(true);
  });

  it('pages drawn before sections get the panel after the answer, once', () => {
    const saved = layoutPreset('answer')!.layout.components.filter((c) => c.component !== 'AnswerSections' && c.id !== 'sections_p')
      .map((c) => (c.id === 'answer_col' ? { ...c, children: ['answer', 'findings_p'] } : c));
    const up = withAnswerSections(saved);
    expect(up.find((c) => c.id === 'answer_col')!.children).toEqual(['answer', 'answer_sections_p', 'findings_p']);
    expect(up.filter((c) => c.component === 'AnswerSections')).toHaveLength(1);
    expect(withAnswerSections(up)).toEqual(up);
    // The preset has it already; with no sections, its panel goes.
    const preset = layoutPreset('answer')!.layout.components;
    expect(withAnswerSections(preset).filter((c) => c.component === 'AnswerSections')).toHaveLength(1);
    const drawn = resolveNotebookLayout(up, { answered: true }, {}, { data: { notebook: { answerSections: [] } } });
    expect(drawn.some((c) => c.component === 'AnswerSections')).toBe(false);
    expect(resolveNotebookLayout(up, { answered: true }, {}, { data: { notebook: { answerSections: [{ title: 'R' }] } } }).some((c) => c.component === 'AnswerSections')).toBe(true);
  });

  it('notebook-read shows them, without what you struck', () => {
    const nb = {
      id: 'cd', title: 'CD ladders', statement: 's', params: [], checks: [], criteria: [], status: 'active', fields: [], stages: [], pipeline: [], cadence: '', createdAt: 'x', updatedAt: 'x',
      answer: {
        question: 'q', text: 'Five CDs.', confidence: 'medium', findings: [], open: [], at: 'x', by: 'w', struck: ['Open them all at one bank'],
        sections: [{ kind: 'steps', title: 'Open the ladder', items: [{ text: 'Check insurance', from: [] }, { text: 'Open them all at one bank', from: [] }] }, { kind: 'table', title: 'Rubric', columns: ['If', 'Then'], rows: [{ cells: ['Need it soon', 'No-penalty CD'], from: [] }] }],
      },
    } as unknown as Notebook;
    expect(notebookReadoutJson(nb, []).answer?.sections).toEqual([{ title: 'Open the ladder', kind: 'steps', lines: ['Check insurance'] }, { title: 'Rubric', kind: 'table', columns: ['If', 'Then'], lines: ['Need it soon · No-penalty CD'] }]);
    const text = notebookReadoutText(nb, []);
    expect(text).toContain('### Open the ladder\n1. Check insurance');
    expect(text).toContain('### Rubric\n(If · Then)\n- Need it soon · No-penalty CD');
  });

  it('keeps a diagram only when its numbers hold: a ladder that runs forward, a split that adds up to the amount asked about', () => {
    const rung = (label: string, start: number, end: number) => ({ label, start, end, amount: 5000, rate: '4.4% APY' });
    const diagrams = (d: unknown[]) => cleanAnswer({ answer: 'x', findings: [], sections: d.map((diagram, i) => ({ kind: 'diagram', title: `D${String(i)}`, diagram, caption: 'Read left to right.' })) }, ids, 'q', 'w', 'x', { amounts: [25000] })?.sections ?? [];
    const ok = diagrams([{ type: 'ladder', rungs: [rung('12-month CD', 0, 12), rung('24-month CD', 0, 24)] }]);
    expect(ok).toEqual([{ kind: 'diagram', title: 'D0', caption: 'Read left to right.', diagram: { type: 'ladder', rungs: [rung('12-month CD', 0, 12), rung('24-month CD', 0, 24)] } }]);
    expect(answerSectionLines(ok[0])).toEqual(['12-month CD: months 0–12, $5,000 at 4.4% APY', '24-month CD: months 0–24, $5,000 at 4.4% APY']);
    // Backwards, made-up, negative, or one rung: not drawn.
    expect(diagrams([{ type: 'ladder', rungs: [rung('a', 12, 6), rung('b', 0, 12)] }])).toEqual([]);
    expect(diagrams([{ type: 'ladder', rungs: [{ label: 'a', start: 0, end: 12, amount: 'lots' }, rung('b', 0, 24)] }])).toEqual([]);
    expect(diagrams([{ type: 'split', parts: [{ label: 'a', amount: -1 }, { label: 'b', amount: 2 }] }])).toEqual([]);
    expect(diagrams([{ type: 'flow', nodes: [{ label: 'only one' }] }])).toEqual([]);
    // A split of the $25,000 adds up to it; one that doesn't isn't drawn.
    expect(diagrams([{ type: 'split', total: 25000, parts: [{ label: 'No-penalty CD', amount: 5000 }, { label: 'Ladder', amount: '$20,000' }] }])[0]).toMatchObject({ diagram: { type: 'split', total: 25000, parts: [{ amount: 5000 }, { amount: 20000 }] } });
    expect(diagrams([{ type: 'split', parts: [{ label: 'a', amount: 5000 }, { label: 'b', amount: 15000 }] }])).toEqual([]);
    // At most two.
    const flow = { type: 'flow', nodes: [{ label: 'a' }, { label: 'b' }] };
    expect(diagrams([flow, flow, flow])).toHaveLength(2);
    expect(notebookAmounts({ title: 'CD ladders for $25,000', statement: 'Invest $25k', params: ['$1.5M max', 'no amount'] }).sort((a, b) => a - b)).toEqual([25000, 1500000]);
    const nb = { checks: [], steps: [{ kind: 'write', shape: 'answer' }] } as unknown as Notebook;
    expect(criterionLink(nb, 'A ladder diagram drawn')).toEqual({ kind: 'written', what: 'diagram' });
  });

  it('the answer gets its drawing too, but not on a page that shows who it is about', () => {
    const page = [
      { id: 'root', component: 'Column', children: ['answer'] },
      { id: 'answer', component: 'Callout', text: { path: '/notebook/answer/text' } },
    ];
    expect(withAnswerSections(page).find((c) => c.id === 'answer')!.image).toEqual({ path: '/notebook/answer/cover' });
    const company = [...page, { id: 'who', component: 'ProfileCard', profile: { path: '/notebook/company' } }];
    expect(withAnswerSections(company).find((c) => c.id === 'answer')!.image).toBeUndefined();
  });
});
