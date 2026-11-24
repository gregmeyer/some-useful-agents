import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotebookStore, RunStore } from '@some-useful-agents/core';
import { formatTemplate, joinWords, printValue, rangeWords, relativeWords } from './a2ui-print-values.js';
import { renderPageBrief } from '../views/notebook-page-brief.js';

const here = dirname(fileURLToPath(import.meta.url));
const browser = await import(join(here, '..', 'assets', 'sua-functions.js')) as { joinWords: typeof joinWords; relativeWords: typeof relativeWords; rangeWords: typeof rangeWords };
let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

describe('A2UI values on paper (ADR-0091)', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const ctx = { data: { kinds: ['hotel', 'rental'], lo: 120000, hi: 140000, at: '2026-11-17T12:00:00Z', n: 3 }, now };

  it('says join, relativeTime and formatRange the way the browser does', () => {
    for (const [l, sep, last] of [[['a', 'b', 'c'], ', ', ' and '], [['x'], ', ', undefined], [[], ', ', undefined]] as const) expect(joinWords(l, sep, last)).toBe(browser.joinWords(l, sep, last));
    for (const iso of ['2026-11-17T12:00:00Z', '2026-11-20T14:00:00Z', 'nope']) expect(relativeWords(iso, now)).toBe(browser.relativeWords(iso, now));
    for (const [a, b, c] of [[120000, 140000, 'USD'], [120, 140, undefined], [90, 90, 'USD'], [undefined, '45000', 'USD']] as const) expect(rangeWords(a, b, c)).toBe(browser.rangeWords(a, b, c));
  });

  it('reads bindings in either form and runs function calls, inside formatString too', () => {
    expect(printValue({ '@path': '/n' }, ctx)).toBe(3);
    expect(printValue({ path: '/kinds' }, ctx)).toEqual(['hotel', 'rental']);
    expect(printValue({ call: 'join', args: { value: { path: '/kinds' }, last: ' and ' } }, ctx)).toBe('hotel and rental');
    expect(printValue({ '@call': 'formatRange', args: { min: { '@path': '/lo' }, max: { '@path': '/hi' }, currency: 'USD' } }, ctx)).toBe('$120K–$140K');
    expect(formatTemplate('${count(value:${/kinds})} kinds: ${join(value:${/kinds})}, ${relativeTime(value:${/at})}; n=${/n}', ctx)).toBe('2 kinds: hotel, rental, 3 days ago; n=3');
    expect(printValue({ call: 'pluralize', args: { value: { path: '/n' }, one: 'option', other: 'options' } }, ctx)).toBe('options');
    expect(printValue({ call: 'nothingLikeThis', args: {} }, ctx)).toBeUndefined();
    // A list's template isn't a binding.
    expect(printValue({ path: '/items', componentId: 'row' }, ctx)).toEqual({ path: '/items', componentId: 'row' });
  });

  it("a notebook's brief prints a function's words, a search table's rows and a chart's data", () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-print-'));
    const s = NotebookStore.fromHandle(new RunStore(join(dir, 'runs.db')).databaseHandle());
    const nb = s.create({ title: 'Find jobs' });
    s.setFields(nb.id, [{ key: 'salary', label: 'Salary', type: 'money', role: 'price' }]);
    for (const [t, pay] of [['Finance Manager · Omni', 200], ['Senior Analyst · Webflow', 120]] as const) { const e = s.addEntry(nb.id, { kind: 'option', title: t, by: 'x' }); s.setOptionFacts(nb.id, e.id, { salary: pay }); }
    s.setLayout(nb.id, { components: [
      { id: 'root', component: 'Column', children: ['count', 'search', 'chart'] },
      { id: 'count', component: 'Text', text: { call: 'formatString', args: { value: '${count(value:${/notebook/options})} in the running' } } },
      { id: 'search', component: 'Table', rows: { '@call': 'findOptions', args: { q: 'analyst' } }, columns: [{ key: 'name', label: 'Option' }, { key: 'salary', label: 'Salary' }] },
      { id: 'chart', component: 'VegaChart', spec: { title: 'Pay by role', data: { values: [{ role: 'Manager', pay: 200 }, { role: 'Analyst', pay: 120 }] }, mark: 'bar', encoding: { x: { field: 'role', type: 'nominal', title: 'Role' }, y: { field: 'pay', type: 'quantitative' } } } },
    ] });
    const out = renderPageBrief({ nb: s.get(nb.id)!, entries: s.entries(nb.id, 1000) });
    expect(out).toContain('2 in the running');
    expect(out).toContain('Senior Analyst · Webflow');
    expect(out).not.toMatch(/<td>[^<]*Finance Manager · Omni/);
    expect(out).toContain('<figcaption class="eyebrow">Pay by role</figcaption>');
    expect(out).toContain('<th>Role</th><th>pay</th>');
    expect(out).toContain('<td>Analyst</td><td>120</td>');
  });
});
