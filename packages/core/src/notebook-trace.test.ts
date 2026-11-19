import { describe, expect, it } from 'vitest';
import { evidenceQuote, findingTrace, htmlText, parseSourceTrace, quoteOnPage, traceQuote } from './notebook-trace.js';

describe("tracing an answer's sources (ADR-0082)", () => {
  it('reads the quote an evidence entry was filed with', () => {
    expect(evidenceQuote('"AG-UI is an open, event-based protocol." AG-UI docs (found by the Web search)')).toBe('AG-UI is an open, event-based protocol.');
    expect(evidenceQuote('A2UI spec (found by the Web search)')).toBe('');
    expect(evidenceQuote('"Only a quote"')).toBe('Only a quote');
  });

  it("finds a quote word for word, whatever the page's spacing, quote marks, dashes or markdown", () => {
    const page = htmlText('<p>AG-UI is an <b>open</b> , lightweight , event-based protocol that standardizes how AI agents connect.</p><script>var x = 1</script>');
    expect(quoteOnPage('AG-UI is an open, lightweight, event-based protocol', page)).toBe(true);
    expect(quoteOnPage('CopilotKit is a three-layer stack (frontend, runtime, agent)', 'CopilotKit is a three-layer stack ( frontend, runtime, agent ) connected')).toBe(true);
    expect(quoteOnPage('it’s the “agent” — not the UI', "It's the \"agent\" - not the UI.")).toBe(true);
    expect(quoteOnPage('A2UI describes it, AG-UI carries it', 'A2UI **describes** it, [AG-UI](https://ag-ui.com) carries it')).toBe(true);
    // Said differently isn't word for word, and a stray few words don't count.
    expect(quoteOnPage('AG-UI is a closed, heavyweight protocol', page)).toBe(false);
    expect(quoteOnPage('open', page)).toBe(false);
  });

  it('reads the page as downloaded, then as rendered; says unread when neither reads', async () => {
    const long = (s: string) => `${s} ${'filler words '.repeat(30)}`;
    const quote = 'A2UI lets an agent describe an interactive UI';
    expect(await traceQuote('https://a2ui.org/', quote, { http: async () => long(quote), rendered: async () => { throw new Error('not reached'); } })).toBe('found');
    // A page that needs a browser: the download is a shell, the render has it.
    expect(await traceQuote('https://a2ui.org/', quote, { http: async () => '<div id=root></div>', rendered: async () => long(quote) })).toBe('found');
    expect(await traceQuote('https://a2ui.org/', quote, { http: async () => long('Something else'), rendered: async () => long('Something else') })).toBe('missing');
    expect(await traceQuote('https://a2ui.org/', quote, { http: async () => { throw new Error('403'); }, rendered: async () => '' })).toBe('unread');
    expect(await traceQuote('https://a2ui.org/', '  ', {})).toBe('no-quote');
    expect(await traceQuote('notebook', quote, {})).toBe('unread');
  });

  it('a finding is verified on a primary page, supported on another, unverified when none was found', () => {
    const at = '2026-11-19T00:00:00.000Z';
    const found = { trace: { status: 'found' as const, at } };
    const missing = { trace: { status: 'missing' as const, at } };
    expect(findingTrace([{ ...found, origin: { publisher: 'A2UI', kind: 'primary' as const, whose: 'A2UI' } }, missing])).toBe('verified');
    expect(findingTrace([{ ...found, origin: { publisher: 'The New Stack', kind: 'independent' as const } }])).toBe('supported');
    expect(findingTrace([missing, { trace: { status: 'unread', at } }])).toBe('unverified');
    // Nothing traced yet, or nothing with a quote to look for: no word either way.
    expect(findingTrace([{}])).toBeUndefined();
    expect(findingTrace([{ trace: { status: 'no-quote', at } }])).toBeUndefined();
    expect(parseSourceTrace({ status: 'found', at })).toEqual({ status: 'found', at });
    expect(parseSourceTrace({ status: 'maybe', at })).toBeUndefined();
  });
});
