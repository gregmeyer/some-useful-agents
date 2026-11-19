import { describe, expect, it } from 'vitest';
import { answerSubjects, evidenceOrigin, parseSourceOrigin, publisherOf, sourceOrigin, sourceSpread, sourceSpreadCaution } from './notebook-source-origin.js';

const subjects = answerSubjects({ title: 'Understand A2UI vs AG-UI vs CopilotKit', statement: 'Help me understand the difference between A2UI, AG-UI, and CopilotKit.' });

describe('where an answer\'s sources come from (ADR-0081)', () => {
  it('reads the subjects from names in the title and what it is for, not ordinary words', () => {
    expect(subjects).toEqual(['A2UI', 'AG-UI', 'CopilotKit']);
    expect(answerSubjects({ title: 'Is a hot dog a sandwich?' })).toEqual([]);
    expect(answerSubjects({ title: 'Prepare for Acme', briefOn: { name: 'Acme Corp' } })).toEqual(['Acme Corp']);
  });

  it('names who publishes a page from its address: a code host\'s owner, else the site without subdomains', () => {
    expect(publisherOf('https://docs.copilotkit.ai/vue/concepts/architecture')).toBe('copilotkit.ai');
    expect(publisherOf('https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/introduction.mdx')).toBe('github.com/ag-ui-protocol');
    expect(publisherOf('https://www.bbc.co.uk/news/x')).toBe('bbc.co.uk');
    expect(publisherOf('not a url')).toBe('unknown');
  });

  it("tells a subject's own pages by their site or repo, not by what a vendor's path mentions", () => {
    expect(sourceOrigin('https://docs.ag-ui.com/introduction', subjects)).toEqual({ publisher: 'AG-UI', kind: 'primary', whose: 'AG-UI' });
    expect(sourceOrigin('https://github.com/a2ui-project/a2ui/blob/main/spec.md', subjects)).toMatchObject({ whose: 'A2UI' });
    // CopilotKit's page about AG-UI and A2UI is CopilotKit's, not theirs.
    expect(sourceOrigin('https://www.copilotkit.ai/ag-ui-and-a2ui', subjects)).toMatchObject({ publisher: 'CopilotKit', whose: 'CopilotKit' });
    // An outside page, nothing said: from outside, kind unknown.
    expect(sourceOrigin('https://thenewstack.io/a2ui-explained', subjects)).toEqual({ publisher: 'thenewstack.io' });
  });

  it('takes what the finder said when it names a subject or a kind, and ignores what it can\'t be', () => {
    // Google makes A2UI: its blog post is A2UI's own, which the address can't tell.
    expect(sourceOrigin('https://developers.googleblog.com/build-generative-ui', subjects, { publisher: 'Google', kind: 'vendor', whose: 'a2ui' }))
      .toEqual({ publisher: 'Google', kind: 'vendor', whose: 'A2UI' });
    expect(sourceOrigin('https://example.org/x', subjects, { whose: 'none', kind: 'trustworthy' })).toEqual({ publisher: 'example.org' });
    // A site named for a subject is that subject's whatever was said.
    expect(sourceOrigin('https://a2ui.org/', subjects, { whose: 'none' })).toMatchObject({ whose: 'A2UI' });
  });

  it('reads a stored origin back, and works one out for evidence filed before origins were kept', () => {
    expect(parseSourceOrigin({ publisher: 'Google', kind: 'nope', whose: '' })).toEqual({ publisher: 'Google' });
    expect(parseSourceOrigin({ kind: 'primary' })).toBeUndefined();
    expect(evidenceOrigin({ fingerprint: 'https://a2ui.org/quickstart' }, subjects)).toMatchObject({ whose: 'A2UI' });
    expect(evidenceOrigin({ origin: { publisher: 'X' }, fingerprint: 'https://a2ui.org/' }, subjects)).toEqual({ publisher: 'X' });
    expect(evidenceOrigin({}, subjects)).toBeUndefined();
  });

  it('counts publishers once however many pages, and cautions when the subjects only speak for themselves', () => {
    const urls = ['https://docs.copilotkit.ai/a', 'https://docs.copilotkit.ai/b', 'https://www.copilotkit.ai/c', 'https://a2ui.org/', 'https://docs.ag-ui.com/x'];
    const own = sourceSpread(urls.map((u) => sourceOrigin(u, subjects)));
    expect(own).toMatchObject({ pages: 5, publishers: 3, own: 5, outside: 0 });
    expect(own.byPublisher[0]).toEqual({ publisher: 'CopilotKit', pages: 3, whose: 'CopilotKit', kind: 'primary' });
    expect(sourceSpreadCaution(own)).toBe("All 5 sources it rests on are the subjects' own pages (CopilotKit 3, A2UI 1, AG-UI 1); none from outside them confirms what they say.");

    const one = sourceSpread([...urls, 'https://thenewstack.io/a', 'https://thenewstack.io/b'].map((u) => sourceOrigin(u, subjects)));
    expect(one.outside).toBe(1);
    expect(sourceSpreadCaution(one)).toMatch(/^Only one of its 4 publishers is from outside the subjects \(thenewstack\.io\)/);

    const two = sourceSpread([...urls, 'https://thenewstack.io/a', 'https://infoq.com/b'].map((u) => sourceOrigin(u, subjects)));
    expect(sourceSpreadCaution(two)).toBeUndefined();
    expect(sourceSpreadCaution(sourceSpread([]))).toBeUndefined();
  });
});
