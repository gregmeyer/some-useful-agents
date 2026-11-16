import { describe, it, expect } from 'vitest';
import { cleanQuote, readableNumbers, roleAtCompany, saidLike, sameQuote, tidyGiven, trimDangling, uniqueQuotes } from './notebook-clean.js';
import { notebookAffiliations } from './notebook-widgets.js';

describe('what the page is given, tidied', () => {
  it('reads round figures written as digits, with a $ when the passage gives money', () => {
    expect(readableNumbers('Series B: 40000000 led by Acme, plus a 60000000 facility (100000000 total)', 'includes a $40 million Series B')).toBe('Series B: $40M led by Acme, plus a $60M facility ($100M total)');
    expect(readableNumbers('Raised 2500000000 so far')).toBe('Raised 2.5B so far');
    expect(readableNumbers('1500000 members')).toBe('1.5M members');
  });

  it('leaves a phone number, an id, a year, a price and a figure already written for reading', () => {
    for (const s of ['Call 4254427401', 'Order 12345678', 'Founded 2019', '$40,000,000 raised', '$40000000 raised', '300 employees', '3.5000000 ratio', 'v10000000x']) expect(readableNumbers(s, '$1')).toBe(s);
  });

  it(`pairs a quote's marks, and knows one line carried by two articles`, () => {
    expect(cleanQuote('Firms scale by adding people. We scale with intelligence,” said the founder.')).toBe('Firms scale by adding people. We scale with intelligence, said the founder.');
    expect(cleanQuote('“We scale with intelligence.”')).toBe('“We scale with intelligence.”');
    const a = 'Traditional accounting firms scale by adding people. We scale with intelligence, said the co-founder and chief executive.';
    const b = '“Traditional accounting firms scale by adding people. We scale with intelligence.” said the founder, CEO.';
    expect(sameQuote(a, b)).toBe(true);
    expect(sameQuote('I think AI is the least important part.', 'Then we go deep on the roadmap.')).toBe(false);
    expect(uniqueQuotes([{ quote: a, n: 1 }, { quote: b, n: 2 }, { quote: 'Something else entirely was said here.', n: 3 }]).map((q) => q.n)).toEqual([1, 3]);
  });

  it(`tells something said from a profile's stats`, () => {
    expect(saidLike('Investment Range $25K - $50K ... Investments On Record 8')).toBe(false);
    expect(saidLike('Investment Range Sweet Spot Current Fund Size')).toBe(false);
    expect(saidLike('I think the AI is the least important part of building an AI enabled service.')).toBe(true);
    expect(saidLike('She said thing 1.')).toBe(true);
  });

  it('names what you gave in their capitals, and drops a stub cut off mid-sentence', () => {
    expect(tidyGiven("dana reyes's linkedin profile", ['Dana Reyes', 'Northwind'])).toBe("Dana Reyes's LinkedIn profile");
    expect(tidyGiven('your résumé', ['Dana Reyes'])).toBe('your résumé');
    expect(trimDangling('Established in 2013. Funds of 50M and 200M (2022). Run by')).toBe('Established in 2013. Funds of 50M and 200M (2022).');
    expect(trimDangling('Established in 2013. Series B')).toBe('Established in 2013. Series B');
    expect(trimDangling('Backs founders with money and help')).toBe('Backs founders with money and help');
  });

  it(`a settled conflict's other claim, "their role, the company", is not a second row for a company they already have`, () => {
    expect(roleAtCompany('Partner, Expa')).toEqual({ name: 'Expa', role: 'Partner' });
    expect(roleAtCompany('Expa')).toEqual({ name: 'Expa' });
    const person = (affiliations: Array<{ name: string }>) => ({ about: { person: {
      name: 'Dana Reyes', facts: [{ key: 'organization', label: 'Company', value: 'Co-founder and CEO, Northwind' }], affiliations,
      conflicts: [{ fact: 'organization', label: 'Company', question: '?', at: '2026-11-16T00:00:00Z', claims: [{ value: 'Partner, Expa', source: 'https://example.com/a' }, { value: 'Co-founder and CEO, Northwind' }], settled: { value: 'Co-founder and CEO, Northwind', by: 'you', at: '2026-11-16T00:00:00Z' } }],
    } } }) as unknown as Parameters<typeof notebookAffiliations>[0];
    expect(notebookAffiliations(person([{ name: 'Expa' }])).map((a) => a.name)).toEqual(['Expa']);
    expect(notebookAffiliations(person([]))).toEqual([{ name: 'Expa', role: 'Partner', source: 'https://example.com/a' }]);
  });
});
