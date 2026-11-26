import { describe, it, expect } from 'vitest';
import { render } from './html.js';
import { renderPanelHome, renderPanelRows } from './panel-home.js';
import { renderInboxModalShell } from './inbox-modal.js';
import { displayTitle, eyebrowOf, itemEyebrow, previewLine } from '../lib/inbox-kind.js';
import type { PanelList, PanelRow } from '../lib/panel-inbox.js';

// The inbox cleanup (DESIGN.md 2026-11-25): what a row is as a word, the need
// as a mark, no pills, and only the search and the tabs before the first row.
const msg = (over: Record<string, unknown>) => ({ id: 't1', title: 'Hello', body: 'x', source: 'manual', status: 'open', priority: 'medium', createdAt: Date.now(), lastActivityAt: Date.now(), ...over }) as unknown as PanelRow['message'];
const list = (rows: PanelRow[]): PanelList => ({ tab: 'open', q: '', filters: {}, wide: false, counts: { needs: 0, open: rows.length, conversations: 0, done: 0 }, rows, offset: 0, hasMore: false });

describe('what a row is', () => {
  it('shows a title without the "Answer: " it is stored with, and says its kind', () => {
    expect(displayTitle('Answer: Find jobs that match my profile')).toBe('Find jobs that match my profile');
    expect(displayTitle('Notebook: Car')).toBe('Car');
    expect(displayTitle('Daily digest — 41 runs')).toBe('Daily digest — 41 runs');
    expect(eyebrowOf(msg({ title: 'Answer: Car' }))).toBe('ANSWER');
    expect(eyebrowOf(msg({ title: 'Daily digest — 41 runs, 25 agents (Nov 24)', source: 'cadence' }))).toBe('DIGEST');
    expect(eyebrowOf(msg({ source: 'conversation', agentId: 'weather' }))).toBe('CHAT · weather');
    expect(eyebrowOf(msg({ source: 'run-failure', agentId: 'ashby' }))).toBe('FAILING · ashby');
    expect(itemEyebrow({ id: 'notebook:car', kind: 'progress', title: 'Answer: Car', subject: {} })).toBe('ANSWER');
    expect(itemEyebrow({ id: 'agent:x:draft', kind: 'decision', title: 'x', subject: { agentId: 'x' } })).toBe('DRAFT · x');
  });

  it("previews sua's words without \"sua: \", yours with \"You: \", and a Done as its counts", () => {
    expect(previewLine({ who: 'sua', text: 'Done: 7 options, 4 sources, 3 quotes found on their pages. One step is yours: Pick one. Open the answer →' })).toBe('Done · 7 options · 4 sources · 3 quotes found · one step is yours');
    expect(previewLine({ who: 'sua', text: 'The latest builds are…' })).toBe('The latest builds are…');
    expect(previewLine({ who: 'you', text: 'what failed?' })).toBe('You: what failed?');
  });
});

describe('the panel list', () => {
  it('rows: eyebrow, age, title without the prefix, one line; the dot is hollow, needs-you or working', () => {
    const rows: PanelRow[] = [
      { message: msg({ id: 'a', title: 'Answer: Headphones for flights' }), kind: 'approve', ask: 'Choose: Move on · Try again' },
      { message: msg({ id: 'b', title: 'what artifacts have you built' }), latest: { who: 'sua', text: 'The latest builds…' } },
      { message: msg({ id: 'c', title: 'Weather chat', source: 'conversation', agentId: 'weather' }), working: 'weather is replying…' },
    ];
    const html = render(renderPanelRows(rows));
    expect(html).not.toContain('>Answer: ');
    expect(html).toContain('<span class="panel-row__eyebrow">ANSWER</span>');
    expect(html).toContain('<span class="panel-row__title is-strong">Headphones for flights</span>');
    expect(html).toContain('panel-row__dot panel-row__dot--needs');
    expect(html).toContain('panel-row__dot panel-row__dot--working');
    expect(html).toContain('<span class="panel-row__eyebrow is-live">CHAT · weather</span>');
    expect(html).not.toContain('sua: ');
    // The old five-colour dots and tag words are gone.
    expect(html).not.toMatch(/panel-row__dot--(approve|answer|fail)|panel-row__tag/);
  });

  it('before the first row: + and ⋯ in the bar, the search, four tabs; no pills, refresh or footer in the list', () => {
    const home = render(renderPanelHome(list([{ message: msg({}) }])));
    expect(home).not.toContain('panel-suggest__pill');
    expect(home).toMatch(/<ul class="panel-suggest" data-panel-suggest aria-label="Things to ask sua" hidden>/);
    expect(home).not.toContain('data-panel-refresh');
    expect(home).not.toContain('panel-home__foot');
    const shell = render(renderInboxModalShell());
    const bar = shell.slice(shell.indexOf('inbox-modal__panelbar"'), shell.indexOf('<div class="inbox-modal__panelbar-menu"'));
    // The bar's controls in view (back shows only over a thread): + and ⋯.
    const inBar = (bar.match(/<button [^>]*data-panel-new|<summary /g) ?? []).length;
    const beforeRow = home.slice(0, home.indexOf('class="panel-row'));
    const inList = (beforeRow.replace(/<ul class="panel-suggest"[\s\S]*?<\/ul>/, '').replace(/<button type="button" class="panel-askrow"[\s\S]*?<\/button>/, '').match(/<input |<button /g) ?? []).length;
    expect(inBar).toBe(2);
    expect(inBar + inList).toBeLessThanOrEqual(7);
    // Widen, Minimize, Refresh and the full inbox are in the bar's ⋯.
    for (const hook of ['data-panel-wide', 'data-panel-min', 'data-panel-refresh', 'href="/inbox"']) expect(shell).toContain(hook);
  });
});
