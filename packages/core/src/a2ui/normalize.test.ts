import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { a2uiId, componentsForRender, normalizeComponents } from './normalize.js';
import { validateViewComponents, viewToMessages } from './view.js';
import { A2UI_PROTOCOL_VERSION } from './catalog.js';

describe('A2UI v0.9 components drawn as v1.0 (ADR-0084)', () => {
  it('a heading variant becomes markdown; a regexp becomes a check', () => {
    expect(normalizeComponents([{ id: 'h', component: 'Text', text: 'Shortlist', variant: 'h3' }])).toEqual([{ id: 'h', component: 'Text', text: '### Shortlist' }]);
    // Bound text can't carry a heading mark: the variant just goes.
    expect(normalizeComponents([{ id: 'h', component: 'Text', text: { path: '/t' }, variant: 'h2' }])).toEqual([{ id: 'h', component: 'Text', text: { path: '/t' } }]);
    expect(normalizeComponents([{ id: 'z', component: 'TextField', label: 'Zip', value: { path: '/zip' }, validationRegexp: '^\\d{5}$' }])[0])
      .toEqual({ id: 'z', component: 'TextField', label: 'Zip', value: { path: '/zip' }, '@checks': [{ condition: { '@call': 'regex', args: { value: { path: '/zip' }, pattern: '^\\d{5}$' } }, message: 'Doesn’t match the expected format.' }] });
  });

  it('renames ids 1.0 refuses (hyphens) and every reference to them', () => {
    expect(a2uiId('rest_tile__system-runs-today')).toBe('rest_tile__system_runs_today');
    expect(a2uiId('2col')).toBe('_2col');
    const out = normalizeComponents([
      { id: 'root', component: 'Column', children: ['top-row', 'list'] },
      { id: 'top-row', component: 'Card', child: 'top_row' },
      { id: 'top_row', component: 'Text', text: 'taken' },
      { id: 'list', component: 'List', children: { path: '/items', componentId: 'item-tpl' } },
      { id: 'item-tpl', component: 'Text', text: { path: 'name' } },
    ]);
    expect(out.map((c) => c.id)).toEqual(['root', 'top_row_2', 'top_row', 'list', 'item_tpl']);
    expect(out[0]).toMatchObject({ children: ['top_row_2', 'list'] });
    expect(out[1]).toMatchObject({ child: 'top_row' });
    expect(out[3]).toMatchObject({ children: { path: '/items', componentId: 'item_tpl' } });
  });

  it("sends bindings in 1.0 form ({\"@path\"}, {\"@call\"}, @checks), keeping a template's plain path", () => {
    const [list, text, field] = componentsForRender([
      { id: 'list', component: 'List', children: { path: '/items', componentId: 't' } },
      { id: 't', component: 'Text', text: { call: 'formatString', args: { value: { path: 'name' } } } },
      { id: 'f', component: 'TextField', label: 'E', value: { path: '/e' }, checks: [{ condition: { call: 'required', args: { value: { path: '/e' } } }, message: 'Needed' }] },
    ]);
    expect(list).toEqual({ id: 'list', component: 'List', children: { path: '/items', componentId: 't' } });
    expect(text).toEqual({ id: 't', component: 'Text', text: { '@call': 'formatString', args: { value: { '@path': 'name' } } } });
    expect(field).toEqual({ id: 'f', component: 'TextField', label: 'E', value: { '@path': '/e' }, '@checks': [{ condition: { '@call': 'required', args: { value: { '@path': '/e' } } }, message: 'Needed' }] });
  });

  it('a v0.9 view validates and is sent as 1.0 messages', () => {
    const comps = [{ id: 'root', component: 'Column', children: ['title', 'm'] }, { id: 'title', component: 'Text', text: 'Hi', variant: 'h3' }, { id: 'm', component: 'Metric', label: 'Runs', value: { path: '/n' } }];
    expect(validateViewComponents(comps)).toMatchObject({ ok: true });
    const msgs = viewToMessages('s', comps as never, { n: '4' });
    expect(A2UI_PROTOCOL_VERSION).toBe('1.0');
    expect(msgs.every((m) => m.version === '1.0')).toBe(true);
    expect((msgs[1].updateComponents as { components: unknown[] }).components).toEqual([comps[0], { id: 'title', component: 'Text', text: '### Hi' }, { id: 'm', component: 'Metric', label: 'Runs', value: { '@path': '/n' } }]);
  });

  it('the server validates with the same A2UI build the browser draws with', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const head = (p: string) => readFileSync(p, 'utf8').slice(0, 400).match(/a2ui-project\/a2ui@([0-9a-f]{12})/)?.[1];
    const server = head(join(here, '..', '..', 'vendor', 'a2ui-web-core-v1.mjs'));
    const browser = head(join(here, '..', '..', '..', 'dashboard', 'src', 'assets', 'vendor', 'a2ui-v1_0.js'));
    expect(server).toMatch(/^[0-9a-f]{12}$/);
    expect(browser).toBe(server);
  });
});
