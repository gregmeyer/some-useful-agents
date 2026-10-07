import { describe, it, expect } from 'vitest';
import { bodyWithLinks, formatFieldValue } from './notebooks.js';
import { render } from './html.js';

describe('notebook entry links', () => {
  it('turns web addresses into links named for their site, keeping trailing punctuation outside', () => {
    const out = render(bodyWithLinks('Not verified: https://www.cargurus.com/Cars/l-Used-Toyota-RAV4?a=1&b=2. Call <them>'));
    expect(out).toContain('<a href="https://www.cargurus.com/Cars/l-Used-Toyota-RAV4?a=1&amp;b=2" class="nb-entry__link" target="_blank" rel="noopener noreferrer"');
    expect(out).toContain('>cargurus.com ↗</a>.');
    expect(out).toContain('&lt;them&gt;');
  });

  it('links only http(s) addresses', () => {
    expect(render(bodyWithLinks('javascript:alert(1) and ftp://x'))).not.toContain('<a ');
  });
});

describe('option facts as people read them', () => {
  it('formats money, units, years and ranges', () => {
    const money = { key: 'salary', label: 'Salary', type: 'money' as const, range: true };
    const sqft = { key: 'size', label: 'Size', type: 'number' as const, unit: 'sq ft' };
    expect(formatFieldValue(money, { min: 150000, max: 180000 })).toBe('$150,000–$180,000');
    expect(formatFieldValue(money, { min: 175000, max: 175000 })).toBe('$175,000');
    expect(formatFieldValue({ ...sqft, range: true }, { min: 650, max: 800 })).toBe('650–800 sq ft');
    expect(formatFieldValue(sqft, 720)).toBe('720 sq ft');
    expect(formatFieldValue({ key: 'year', label: 'Year', type: 'number' }, 2010)).toBe('2010');
  });
});

describe('notebook covers', () => {
  it('picks an icon from what the notebook is about, and draws a safe inline cover', async () => {
    const { notebookKind, coverArt } = await import('./notebooks.js');
    expect(notebookKind({ title: 'Buy a used car for Nadia', statement: '' })).toBe('car');
    expect(notebookKind({ title: 'Find a remote staff engineering role', statement: '' })).toBe('job');
    expect(notebookKind({ title: 'Search for an acoustic guitar', statement: '' })).toBe('music');
    expect(notebookKind({ title: 'Plan the reunion', statement: '' })).toBe('notebook');
    const svg = render(coverArt({ id: 'a"<x', title: '<script>', statement: '', stages: ['Found', 'Checked'] }));
    expect(svg).toContain('<svg class="nbl-card__art"');
    expect(svg).not.toContain('<script');
    expect(svg).toContain('id="nbc-ax"');
  });
});

describe('the talk box catches up when the sua panel closes', () => {
  it('the panel announces its thread on close, and a notebook page on that thread refetches its talk box', async () => {
    const { INBOX_MODAL_JS } = await import('./inbox-modal.js.js');
    const { NOTEBOOK_PAGE_JS } = await import('./notebook-page.js.js');
    expect(INBOX_MODAL_JS).toContain("new CustomEvent('sua:panel-closed', { detail: { threadId: keep } })");
    expect(NOTEBOOK_PAGE_JS).toContain("addEventListener('sua:panel-closed'");
    expect(NOTEBOOK_PAGE_JS).toContain("getAttribute('data-nb-continue') === tid");
    expect(NOTEBOOK_PAGE_JS).toContain("querySelector('.nb-talk')");
  });
});

describe('an open panel follows you to a notebook', () => {
  it('a page names its conversation, and a restoring open panel opens it instead of the last thread', async () => {
    const { INBOX_MODAL_JS } = await import('./inbox-modal.js.js');
    expect(INBOX_MODAL_JS).toContain("document.querySelector('[data-page-thread]')");
    expect(INBOX_MODAL_JS).toContain("if (own && (saved.mode === 'docked' || saved.mode === 'wide')) { openFor(own,");
  });
});

describe('the decision box speaks about this notebook', () => {
  it('leads are the options in the running, furthest stage first, then the best price; the example names them', async () => {
    const { decisionLeads, decisionPlaceholder } = await import('./notebooks.js');
    const nb = { id: 'n', title: 'Job', statement: '', params: [], criteria: [], status: 'active', pipeline: [], checks: [],
      stages: ['Found', 'Applied', 'Offer'], fields: [{ key: 'salary', label: 'Salary', type: 'money', role: 'price', better: 'higher' }],
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' } as never;
    const opt = (id: string, title: string, salary: number, extra: Record<string, unknown> = {}) => ({
      id, notebookId: 'n', kind: 'option', title, body: '', by: 'sua', createdAt: '2026-10-01T00:00:00Z', data: { salary }, ...extra });
    const entries = [
      opt('a', 'Acme, staff engineer', 150000),
      opt('b', 'Globex, senior engineer', 190000),
      opt('c', 'Initech, lead', 170000, { stage: 'Offer' }),
      opt('d', 'Umbrella, principal', 250000, { ruledOut: { reason: 'too far', at: '2026-10-02T00:00:00Z', by: 'you' } }),
    ] as never;
    const leads = decisionLeads(nb, entries);
    expect(leads.map((o) => o.name)).toEqual(['Initech, lead', 'Globex, senior engineer', 'Acme, staff engineer']);
    expect(decisionPlaceholder(leads)).toBe('Chose Initech, lead: why it fits. Not Globex, senior engineer: why not.');
    expect(decisionPlaceholder(leads.slice(0, 1))).toBe('Chose Initech, lead: why it fits.');
    expect(decisionPlaceholder([])).not.toMatch(/RAV4|CR-V/);
  });
});

describe('money reads at a glance', () => {
  it('a million and up is $18M; smaller amounts keep their digits', async () => {
    const { formatFieldValue, formatMoney } = await import('./notebooks.js');
    expect(formatMoney(18_000_000)).toBe('$18M');
    expect(formatMoney(2_500_000_000)).toBe('$2.5B');
    expect(formatMoney(11_450)).toBe('$11,450');
    expect(formatFieldValue({ key: 'revenue', label: 'Revenue', type: 'money' }, { min: 18e6, max: 22e6 })).toBe('$18M–$22M');
  });
});
