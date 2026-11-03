import { describe, it, expect } from 'vitest';
import { cleanAnswer, cleanPlan, criterionLink, criterionMet, notebookAmounts, answerSectionLines, recomputeDiagram, diagramParamRange, diagramParamWords, type Notebook, type NotebookAnswerDiagram, type NotebookDiagramParam } from './notebooks.js';
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
        key: 'rubric', kind: 'table', title: 'Rubric', delivers: 'A simple decision rubric written for the $25,000', columns: ['If…', 'Then…', 'Why', 'x', 'y'],
        rows: [{ cells: ['You need it within a year', 'A no-penalty CD', 'No penalty to take it out', 'extra', ''], from: ['a'] }, { cells: ['Not for 2 years', '24-month CD', '', '', ''], from: [] }],
      },
      { key: 'open-the-ladder', kind: 'steps', title: 'Open the ladder', items: [{ text: 'Check each bank is insured', from: [] }, { text: 'Open five CDs', detail: '$5,000 each', from: ['b'] }] },
      { key: 'how-it-works', kind: 'text', title: 'How it works', body: 'Each CD comes due a year apart.' },
      { key: 'says-it-gives-one-the-notebook-does-not-have', kind: 'table', title: 'Says it gives one the notebook does not have', columns: ['A', 'B'], rows: [{ cells: ['1', '2'], from: [] }] },
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
    // A shortlist that writes itself up: "a final list recorded" is the write-up's groups table; a rubric is still one it can write. Without the step, as before.
    const writesUp = { checks: [], steps: [{ id: 'w', title: 'Write up the field', kind: 'write', shape: 'writeup' }, { id: 's', title: 'Decide', kind: 'decide' }] } as unknown as Notebook;
    expect(criterionLink(writesUp, 'A final list of 10 roles recorded')).toEqual({ kind: 'written', what: 'table' });
    expect(criterionLink(writesUp, 'Recommendations written')).toEqual({ kind: 'written', what: 'any' });
    expect(criterionLink(writesUp, 'A simple decision rubric written')).toEqual({ kind: 'written', what: 'table' });
    expect(criterionLink(writesUp, 'A decision recorded')).toEqual({ kind: 'decide' });
    expect(criterionLink(shortlist, 'A final list of 10 roles recorded')).toEqual({ kind: 'decide' });
    expect(criterionLink(answerNb, 'A final list of 10 roles recorded')).toEqual({ kind: 'decide' });

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
    // An answer page as it was drawn before sections: the answer and the findings in a column beside the steps.
    const saved = [
      { id: 'root', component: 'Column', children: ['top'] },
      { id: 'top', component: 'Columns', children: ['answer_col', 'steps_panel'], widths: [2, 1] },
      { id: 'answer_col', component: 'Column', children: ['answer', 'findings_p'] },
      ...layoutPreset('answer')!.layout.components.filter((c) => ['answer', 'findings_p', 'findings', 'steps_panel', 'steps'].includes(c.id)),
    ];
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
    expect(ok).toEqual([{ key: 'd0', kind: 'diagram', title: 'D0', caption: 'Read left to right.', diagram: { type: 'ladder', rungs: [rung('12-month CD', 0, 12), rung('24-month CD', 0, 24)] } }]);
    expect(answerSectionLines(ok[0])).toEqual(['12-month CD: months 0–12, $5,000 at 4.4% APY', '24-month CD: months 0–24, $5,000 at 4.4% APY']);
    // Backwards, made-up, negative, or one rung: not drawn.
    expect(diagrams([{ type: 'ladder', rungs: [rung('a', 12, 6), rung('b', 0, 12)] }])).toEqual([]);
    expect(diagrams([{ type: 'ladder', rungs: [{ label: 'a', start: 0, end: 12, amount: 'lots' }, rung('b', 0, 24)] }])).toEqual([]);
    expect(diagrams([{ type: 'split', parts: [{ label: 'a', amount: -1 }, { label: 'b', amount: 2 }] }])).toEqual([]);
    expect(diagrams([{ type: 'flow', nodes: [{ label: 'only one' }] }])).toEqual([]);
    // A split of the $25,000 adds up to it; one that doesn't isn't drawn.
    expect(diagrams([{ type: 'split', total: 25000, parts: [{ label: 'No-penalty CD', amount: 5000 }, { label: 'Ladder', amount: '$20,000' }] }])[0]).toMatchObject({ diagram: { type: 'split', total: 25000, parts: [{ amount: 5000 }, { amount: 20000 }] } });
    expect(diagrams([{ type: 'split', parts: [{ label: 'a', amount: 5000 }, { label: 'b', amount: 15000 }] }])).toEqual([]);
  });

  it('keeps the what-ifs a writer names, each at the diagram\'s own value with a range that holds it', () => {
    const rung = (label: string, start: number, end: number) => ({ label, start, end, amount: 5000 });
    const one = (diagram: unknown) => cleanAnswer({ answer: 'x', findings: [], sections: [{ kind: 'diagram', title: 'D', diagram }] }, ids, 'q', 'w', 'x', { amounts: [25000] })?.sections?.[0];
    const ladder = one({ type: 'ladder', rungs: [12, 24, 36, 48, 60].map((m) => rung(`${String(m)}-month CD`, 0, m)), params: [{ key: 'amount', label: 'Amount to ladder' }, { key: 'months', min: 12, max: 120 }, { key: 'count' }, 'bogus'] });
    expect(ladder && ladder.kind === 'diagram' && ladder.diagram.type === 'ladder' ? ladder.diagram.params : undefined).toEqual([
      // The value is the ladder's own: $25,000 across the rungs; sua's range, $500 steps.
      { key: 'amount', label: 'Amount to ladder', value: 25000, min: 5000, max: 75000, step: 500 },
      // A range the writer gave holds the value, so it's kept; at most two.
      { key: 'months', label: 'Longest term', value: 60, min: 12, max: 120, step: 1 },
    ]);
    // A range that doesn't hold the value is replaced by sua's; a key the diagram can't move is dropped; a bad one too.
    const split = one({ type: 'split', total: 25000, parts: [{ label: 'a', amount: 5000 }, { label: 'b', amount: 20000 }], params: [{ key: 'months' }, { key: 'amount', min: 30000, max: 1000 }, { key: 'amount' }] });
    expect(split && split.kind === 'diagram' && split.diagram.type === 'split' ? split.diagram.params : undefined).toEqual([{ key: 'amount', label: 'Amount', value: 25000, min: 5000, max: 75000, step: 500 }]);
    // A ladder without every rung's amount can't move the amount; none named, none kept.
    const bare = one({ type: 'ladder', rungs: [{ label: 'a', start: 0, end: 12 }, { label: 'b', start: 0, end: 24 }], params: [{ key: 'amount' }] });
    expect(bare && bare.kind === 'diagram' ? bare.diagram : undefined).toEqual({ type: 'ladder', rungs: [{ label: 'a', start: 0, end: 12 }, { label: 'b', start: 0, end: 24 }] });
    expect(diagramParamRange('count', 5)).toEqual({ min: 2, max: 8, step: 1 });
    expect(diagramParamWords('months', 18)).toBe('18 mo');
    expect(diagramParamWords('months', 24)).toBe('2 yr');
    expect(diagramParamWords('count', 5)).toBe('5 rungs');
  });

  it('recomputes a diagram at other values, and gives it back as written at its own', () => {
    const rung = (label: string, end: number, amount: number) => ({ label, start: 0, end, amount, rate: '4% APY' });
    const ladder: NotebookAnswerDiagram = { type: 'ladder', rungs: [rung('1 yr', 12, 5000), rung('2 yr', 24, 5000), rung('3 yr', 36, 5000)], params: [{ key: 'amount', label: 'Amount', value: 15000, min: 3000, max: 45000, step: 500 }, { key: 'months', label: 'Longest term', value: 36, min: 9, max: 72, step: 1 }] };
    expect(recomputeDiagram(ladder, { amount: 15000, months: 36 })).toBe(ladder);
    expect(recomputeDiagram(ladder, {})).toBe(ladder);
    // The amount re-divides in the rungs' own proportions, whole dollars, the last taking the rounding.
    expect(recomputeDiagram(ladder, { amount: 20000 }).type === 'ladder' && (recomputeDiagram(ladder, { amount: 20000 }) as Extract<NotebookAnswerDiagram, { type: 'ladder' }>).rungs.map((r) => r.amount)).toEqual([6667, 6667, 6666]);
    // The longest term scales every rung; rates stay.
    const longer = recomputeDiagram(ladder, { months: 72 }) as Extract<NotebookAnswerDiagram, { type: 'ladder' }>;
    expect(longer.rungs.map((r) => [r.end, r.rate])).toEqual([[24, '4% APY'], [48, '4% APY'], [72, '4% APY']]);
    // Out of range is clamped; a key the diagram has no what-if for is ignored.
    expect((recomputeDiagram(ladder, { months: 1000 }) as Extract<NotebookAnswerDiagram, { type: 'ladder' }>).rungs[2].end).toBe(72);
    expect(recomputeDiagram(ladder, { count: 5 })).toBe(ladder);
    // Another count of rungs rebuilds the ladder as equal rungs up to the longest term; no rate can be known.
    const count: NotebookDiagramParam = { key: 'count', label: 'Rungs', value: 3, min: 2, max: 8, step: 1 };
    const five: NotebookAnswerDiagram = { ...ladder, params: [...ladder.params!, count].slice(1) };
    const rebuilt = recomputeDiagram(five, { count: 5 }) as Extract<NotebookAnswerDiagram, { type: 'ladder' }>;
    expect(rebuilt.rungs).toEqual([
      { label: '7 mo rung', start: 0, end: 7, amount: 3000 }, { label: '14 mo rung', start: 0, end: 14, amount: 3000 }, { label: '22 mo rung', start: 0, end: 22, amount: 3000 },
      { label: '29 mo rung', start: 0, end: 29, amount: 3000 }, { label: '3 yr rung', start: 0, end: 36, amount: 3000 },
    ]);
    // A split re-divides its amount.
    const split: NotebookAnswerDiagram = { type: 'split', total: 1500, parts: [{ label: 'Dinners', amount: 600 }, { label: 'Days out', amount: 500 }, { label: 'Loose', amount: 400 }], params: [{ key: 'amount', label: 'Budget', value: 1500, min: 300, max: 4500, step: 50 }] };
    expect(recomputeDiagram(split, { amount: 2000 })).toEqual({ ...split, total: 2000, parts: [{ label: 'Dinners', amount: 800 }, { label: 'Days out', amount: 667 }, { label: 'Loose', amount: 533 }] });
    expect(recomputeDiagram(split, { amount: 1500 })).toBe(split);
    // A flow has nothing to move.
    const flow: NotebookAnswerDiagram = { type: 'flow', nodes: [{ label: 'a' }, { label: 'b' }] };
    expect(recomputeDiagram(flow, { amount: 5 })).toBe(flow);
  });

  it('draws at most two diagrams, reads the amounts a notebook names, and links a drawn done-when', () => {
    const diagrams = (d: unknown[]) => cleanAnswer({ answer: 'x', findings: [], sections: d.map((diagram, i) => ({ kind: 'diagram', title: `D${String(i)}`, diagram })) }, ids, 'q', 'w', 'x', { amounts: [25000] })?.sections ?? [];
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

  it('a plan has parts too, its page gets them after the days, and "the plan written" ticks once it is', () => {
    const plan = cleanPlan({ summary: 's', items: [{ when: 'Day 1', title: 'Walk' }], sections: [{ kind: 'steps', title: 'Get ready', delivers: 'packing list written', items: ['Pack', 'Book'] }] }, ids, 'w', 'x', { criteria: ['Packing list written'] })!;
    expect(plan.sections).toEqual([{ key: 'get-ready', kind: 'steps', title: 'Get ready', delivers: 'Packing list written', items: [{ text: 'Pack', from: [] }, { text: 'Book', from: [] }] }]);
    const nb = { checks: [], status: 'active', criteria: [], fields: [], steps: [{ kind: 'write', shape: 'plan' }] } as unknown as Notebook;
    expect(criterionLink(nb, 'The 3-day Lisbon plan written')).toEqual({ kind: 'written', what: 'any' });
    expect(criterionMet(nb, [], 'The 3-day Lisbon plan written')).toBe(false);
    expect(criterionMet({ ...nb, plan } as Notebook, [], 'The 3-day Lisbon plan written')).toBe(true);
    expect(criterionMet({ ...nb, plan } as Notebook, [], 'Packing list written')).toBe(true);
    // A plan page saved before: the parts after the days' panel, and the drawing beside the plan.
    const saved = [
      { id: 'root', component: 'Column', children: ['top'] },
      { id: 'top', component: 'Columns', children: ['plan_col', 'steps_panel'], widths: [2, 1] },
      { id: 'plan_col', component: 'Column', children: ['intro', 'days_p'] },
      ...layoutPreset('plan')!.layout.components.filter((c) => ['intro', 'days_p', 'days', 'steps_panel', 'steps'].includes(c.id)).map((c) => (c.id === 'intro' ? { ...c, image: undefined } : c.id === 'days_p' ? { ...c, hero: undefined } : c)),
    ];
    const up = withAnswerSections(saved);
    expect(up.find((c) => c.id === 'plan_col')!.children).toEqual(['intro', 'days_p', 'plan_sections_p']);
    expect(up.find((c) => c.id === 'intro')!.image).toEqual({ path: '/notebook/planIntro/cover' });
    expect(withAnswerSections(up)).toEqual(up);
  });
});
