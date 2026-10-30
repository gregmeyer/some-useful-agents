import { describe, it, expect } from 'vitest';
import type { Notebook, NotebookEntry } from '@some-useful-agents/core';
import { checkCorrection, correctionParts, describeCorrection, parseCorrection, type Correction } from './notebook-correction.js';

// A shopping notebook: two options, a check each passed or failed, a pick, and talking points citing them.
const nb = {
  id: 'n', title: 'Buy a stand mixer', statement: 'A mixer for bread', params: ['under $400'], checks: ['Under $400', 'Bowl of 5 qt or more'],
  criteria: [{ text: 'One picked', met: false }],
  fields: [{ key: 'price', label: 'Price', type: 'money' }, { key: 'bowl', label: 'Bowl', type: 'text' }],
  about: { company: { name: 'KitchenAid', facts: [{ key: 'hq', label: 'Headquarters', value: 'Benton Harbor', at: 'x', source: 'https://example.com' }], updatedAt: 'x' } },
  answer: { question: 'Which mixer?', text: 'The Artisan.', confidence: 'medium', findings: [{ text: 'The Artisan is $350 at Target', from: ['a'] }, { text: 'Bowls under 5 qt struggle with bread', from: [] }], open: [], at: 'x', by: 'notebook-writer' },
} as unknown as Notebook;
const option = (id: string, title: string, extra: Partial<NotebookEntry>) => ({ id, notebookId: 'n', kind: 'option', title, body: '', by: 'agent:x', createdAt: 'x', ...extra }) as NotebookEntry;
const entries = [
  option('a', 'Artisan', { data: { price: 350, bowl: '5 qt' }, factMeta: { price: { source: 'https://target.example/a', quote: '$350.00' } }, checked: ['Under $400', 'bowl of 5 qt or more'], chosenAt: 'x' }),
  option('b', 'Classic', { data: { price: 280 }, failedChecks: { 'Bowl of 5 qt or more': '4.5 qt bowl' } }),
  option('c', 'Mini', { data: { price: 300 }, ruledOut: { reason: 'Fails "Under $400": "$420"', at: 'x', by: 'agent:notebook-checker' } }),
  { id: 'e1', notebookId: 'n', kind: 'note', title: 'Wants it for sourdough', body: '', by: 'you', createdAt: 'x' } as NotebookEntry,
];
const delta = (over: Partial<Correction['semantic_delta']>, impact: Correction['impact'] = []): Correction => ({
  semantic_delta: { type: 'option-fact', target_id: 'option:a:price', old_value: '350', new_value: '450', ...over }, impact, clarification_required: false, clarification_question: '',
});

describe('notebook corrections', () => {
  it('reads the notebook as parts with ids, roles and what each rests on', () => {
    const parts = correctionParts(nb, entries);
    const by = Object.fromEntries(parts.map((p) => [p.id, p]));
    expect(by['limit:0']).toMatchObject({ role: 'rule', text: 'under $400' });
    expect(by['about:company:hq']).toMatchObject({ role: 'evidence', source: 'https://example.com' });
    expect(by['option:a:price']).toMatchObject({ role: 'evidence', text: 'Artisan, Price: $350', quote: '$350.00' });
    // Check results by the check's place, whatever its case.
    expect(by['option:a:check:1']).toMatchObject({ role: 'judgment', kind: 'check passed' });
    expect(by['option:b:check:1']).toMatchObject({ kind: 'check failed', text: 'Classic fails "Bowl of 5 qt or more": 4.5 qt bowl' });
    expect(by['option:a:pick']).toMatchObject({ role: 'judgment' });
    // Ruled out by a check: that check's failure, and the rule-out.
    expect(by['option:c:check:0']).toMatchObject({ kind: 'check failed', text: 'Mini fails "Under $400" (so it was ruled out)' });
    expect(by['option:c:ruled-out']).toMatchObject({ kind: 'ruled out' });
    expect(by['finding:0']).toMatchObject({ role: 'judgment', from: ['option:a'] });
    expect(by['entry:e1']).toMatchObject({ role: 'evidence', kind: 'note' });
  });

  it('parses the agent\'s block, and drops what it can\'t use', () => {
    const c = parseCorrection(`ok <correction>${JSON.stringify({ semantic_delta: { type: 'nonsense', target_id: 'x', old_value: 350, new_value: 450 }, impact: [{ object_id: 'option:a:pick', action: 'reevaluate', reason: 'price' }, { object_id: 'y', action: 'maybe' }], clarification_required: 'true', clarification_question: 'Which one?' })}</correction>`)!;
    expect(c).toEqual({ semantic_delta: { type: 'other', target_id: 'x', old_value: '350', new_value: '450' }, impact: [{ object_id: 'option:a:pick', action: 'reevaluate', reason: 'price' }], clarification_required: true, clarification_question: 'Which one?' });
    expect(parseCorrection('no block')).toBeUndefined();
  });

  it('follows the notebook\'s links from an option\'s fact, and never drops evidence for another part\'s change', () => {
    const out = checkCorrection(nb, entries, delta({}, [{ object_id: 'about:company:hq', action: 'invalidate', reason: 'x' }, { object_id: 'made:up', action: 'invalidate', reason: 'x' }, { object_id: 'option:a:price', action: 'invalidate', reason: 'the target' }]));
    if ('question' in out) throw new Error(out.question);
    const got = Object.fromEntries(out.correction.impact.map((x) => [x.object_id, x.action]));
    expect(got).toEqual({
      'about:company:hq': 'reevaluate',
      'option:a:check:0': 'reevaluate', 'option:a:check:1': 'reevaluate', 'option:a:pick': 'reevaluate',
      'finding:0': 'reevaluate',
    });
    const { rows, summary } = describeCorrection(nb, entries, out.correction);
    expect(rows[0]).toEqual({ what: 'Artisan, Price', before: '350', after: '450' });
    expect(rows.at(-1)).toEqual({ what: 'keeps', before: '—', after: 'everything else in the notebook as it is' });
    expect(summary).toBe('Artisan, Price: 350 → 450. Rewrites 1, looks again at 3, flags 1 that may be out of date; everything else stays as it is.');
    // Nothing rests on it: said so.
    expect(describeCorrection(nb, entries, delta({ type: 'about-fact', target_id: 'about:company:hq', old_value: 'Benton Harbor', new_value: 'Chicago', label: 'Headquarters' })).summary).toBe('Headquarters: Benton Harbor → Chicago. Nothing else changes.');
  });

  it('keeps just the values when the agent gives a part\'s whole text', () => {
    const out = checkCorrection(nb, entries, delta({ old_value: 'Artisan, Price: $350', new_value: 'Artisan, Price: $450' }));
    expect('correction' in out && out.correction.semantic_delta).toMatchObject({ old_value: '$350', new_value: '$450' });
  });

  it('a check reaches the options checked against it; something sua wrote is the part that goes', () => {
    const check = checkCorrection(nb, entries, delta({ type: 'check', target_id: 'check:1', old_value: 'Bowl of 5 qt or more', new_value: 'Bowl of 4 qt or more' }));
    expect('correction' in check && check.correction.impact.map((x) => x.object_id).sort()).toEqual(['option:a:check:1', 'option:b:check:1']);
    const wrong = checkCorrection(nb, entries, delta({ type: 'written', target_id: 'finding:1', old_value: 'Bowls under 5 qt struggle with bread', new_value: '' }));
    expect('correction' in wrong && wrong.correction.impact).toEqual([{ object_id: 'finding:1', action: 'invalidate', reason: "you said it's wrong" }]);
  });

  it('a check every option was checked on: the first few on the card, then how many more', () => {
    const many = Array.from({ length: 8 }, (_, i) => option(`m${String(i)}`, `Mixer ${String(i)}`, { checked: ['Bowl of 5 qt or more'] }));
    const out = checkCorrection(nb, many, delta({ type: 'check', target_id: 'check:1', old_value: 'Bowl of 5 qt or more', new_value: 'Bowl of 4 qt or more' }));
    if ('question' in out) throw new Error(out.question);
    const { rows, summary } = describeCorrection(nb, many, out.correction);
    expect(rows[0]).toEqual({ what: 'check', before: 'Bowl of 5 qt or more', after: 'Bowl of 4 qt or more' });
    expect(rows.filter((r) => r.what === 'look again')).toHaveLength(6);
    expect(rows.at(-2)).toEqual({ what: 'look again', before: '—', after: "and 3 more options' results for it" });
    expect(summary).toBe('Check: Bowl of 5 qt or more → Bowl of 4 qt or more. Checks the options against it, looks again at 8; everything else stays as it is.');
  });

  it("a picture's link kept as a fact says it isn't the picture, and a new link for it changes the picture", () => {
    const withLink = { ...nb, about: { ...nb.about, company: { ...nb.about!.company!, facts: [...nb.about!.company!.facts, { key: 'image', label: 'Logo link', value: 'https://kitchenaid.example/new.png', at: 'x' }] } } } as unknown as Notebook;
    const pictures = { company: { sourceUrl: 'https://old.example/logo.png' } } as never;
    const parts = correctionParts(withLink, entries, undefined, pictures);
    expect(parts.find((p) => p.id === 'about:company:image')?.kind).toBe("company fact, only a picture's link (not the logo shown: that's about:company:photo)");
    const out = checkCorrection(withLink, entries, delta({ type: 'other', target_id: 'about:company:image', old_value: '', new_value: 'https://kitchenaid.example/new.png' }), undefined, pictures);
    if ('question' in out) throw new Error(out.question);
    expect(out.correction.semantic_delta).toMatchObject({ type: 'about-fact', target_id: 'about:company:photo', old_value: 'https://old.example/logo.png', new_value: 'https://kitchenaid.example/new.png' });
    // The link fact goes with it.
    expect(out.correction.impact).toContainEqual(expect.objectContaining({ object_id: 'about:company:image', action: 'invalidate' }));
    // Already the picture shown: nothing to change.
    expect(checkCorrection(withLink, entries, delta({ type: 'about-fact', target_id: 'about:company:image', old_value: '', new_value: 'https://old.example/logo.png' }), undefined, pictures)).toHaveProperty('question');
  });

  it('asks instead of guessing: when the agent asks, or names a part the notebook doesn\'t have', () => {
    expect(checkCorrection(nb, entries, { ...delta({}), clarification_required: true, clarification_question: 'The Artisan or the Classic?' })).toEqual({ question: 'The Artisan or the Classic?' });
    expect(checkCorrection(nb, entries, delta({ target_id: 'option:zz:price' }))).toEqual({ question: 'Which part of the notebook is wrong, and what should it say?' });
    expect(checkCorrection(nb, entries, delta({ type: 'limit', target_id: 'check:0' }))).toHaveProperty('question');
    // A fact about them it doesn't have yet is fine, with a value; one about someone it doesn't know isn't.
    expect(checkCorrection(nb, entries, delta({ type: 'about-fact', target_id: 'about:company:founded', old_value: '', new_value: '1919', label: 'Founded' }))).toHaveProperty('correction');
    expect(checkCorrection(nb, entries, delta({ type: 'about-fact', target_id: 'about:person:role', old_value: '', new_value: 'CEO' }))).toHaveProperty('question');
    // Already so: nothing to change.
    expect(checkCorrection(nb, entries, delta({ type: 'about-fact', target_id: 'about:company:hq', old_value: 'Chicago', new_value: 'benton harbor', label: 'Headquarters' }))).toEqual({ question: 'The notebook already says Headquarters is benton harbor. What should change?' });
  });
});
