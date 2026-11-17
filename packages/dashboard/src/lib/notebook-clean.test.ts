import { describe, it, expect } from 'vitest';
import { cleanQuote, pullQuoteOf, readableNumbers, roleAtCompany, saidLike, sameQuote, tidyGiven, trimDangling, uniqueQuotes } from './notebook-clean.js';
import { notebookAffiliations } from './notebook-widgets.js';
import { readerPage } from '@some-useful-agents/core';
import { SourceNotes } from '../views/brief-document.js';

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
  it('the pull quote you chose leads, and a line you said is not theirs leaves the quotes', () => {
    const kept = [{ quote: 'Then we go deep on the roadmap and the future of the one-person business.' }, { quote: 'I started this because freelancers are founders.' }, { quote: 'We hire slowly on purpose.' }];
    // Nothing chosen: the first that reads as said.
    expect(pullQuoteOf({ facts: [] }, kept)).toMatchObject({ lead: kept[0].quote, from: kept[0], others: [kept[1], kept[2]] });
    // The kept quote that leads comes back, so the page can say where it was said; words of your own have no source.
    expect(pullQuoteOf({ facts: [{ key: 'pull_quote', value: 'freelancers are founders' }] }, kept).from).toBe(kept[1]);
    expect(pullQuoteOf({ facts: [{ key: 'pull_quote', value: 'Something she told me over coffee last week.' }] }, kept).from).toBeUndefined();
    const about = {
      facts: [{ key: 'pull_quote', value: 'The model is the least important part of the service.' }],
      conflicts: [{ fact: 'pull_quote', settled: { wrong: ['Then we go deep on the roadmap and the future of the one-person business'] } }],
    };
    const chosen = pullQuoteOf(about, kept);
    expect(chosen.lead).toBe('The model is the least important part of the service.');
    expect(chosen.quotes).toEqual([kept[1], kept[2]]);
    expect(chosen.others).toEqual([kept[1], kept[2]]);
    // One of the kept quotes, chosen: it leads and isn't said twice.
    expect(pullQuoteOf({ facts: [{ key: 'pull_quote', value: 'We hire slowly on purpose' }] }, kept).others).toEqual([kept[0], kept[1]]);
    // Chosen in other words than the source's: the kept quote that holds them leads, word for word.
    expect(pullQuoteOf({ facts: [{ key: 'pull_quote', value: 'freelancers are founders' }] }, kept)).toMatchObject({ lead: 'I started this because freelancers are founders.', others: [kept[0], kept[2]] });
  });
});

describe('a link opens the page a person reads', () => {
  it('gives the page for a text copy of it, and leaves real pages and Markdown files alone', () => {
    expect(readerPage('https://apply.workable.com/acme/jobs/view/56E06F6960.md')).toBe('https://apply.workable.com/acme/j/56E06F6960/');
    expect(readerPage('https://apply.workable.com/acme/jobs/view/56E06F6960')).toBe('https://apply.workable.com/acme/j/56E06F6960/');
    expect(readerPage('https://www.example.com/startups/acme.md')).toBe('https://www.example.com/startups/acme');
    expect(readerPage('https://www.example.com/startups/acme.md?ref=x')).toBe('https://www.example.com/startups/acme?ref=x');
    for (const u of ['https://github.com/acme/tool/blob/main/README.md', 'https://raw.githubusercontent.com/acme/tool/main/README.md', 'https://jobs.example.com/acme/123', 'https://example.com/.md', 'not an address', 'ftp://example.com/a.md']) expect(readerPage(u)).toBe(u);
    expect(readerPage(undefined)).toBeUndefined();
  });

  it('a source note lists the page, and a text copy and its page are one source', () => {
    const notes = new SourceNotes();
    expect(notes.cite({ url: 'https://www.example.com/startups/acme.md' })).toBe(1);
    expect(notes.cite({ url: 'https://www.example.com/startups/acme' })).toBe(1);
    expect(notes.all[0].url).toBe('https://www.example.com/startups/acme');
  });
});
