import { describe, expect, it } from 'vitest';
import { validateViewComponents } from './view.js';
import { normalizeComponents } from './normalize.js';
import { suaCatalogDocument } from './catalog.js';

describe('VegaChart (ADR-0089)', () => {
  const chart = { id: 'c', component: 'VegaChart', height: 200, spec: { data: { values: { path: '/rows' } }, mark: 'bar', encoding: { x: { field: 'name', type: 'nominal' }, y: { field: 'n', type: 'quantitative' } } } };
  it('validates as a sua component, with its spec and height', () => {
    expect(validateViewComponents([{ id: 'root', component: 'Column', children: ['c'] }, chart]).ok).toBe(true);
    expect(validateViewComponents([{ id: 'root', component: 'Column', children: ['c'] }, { ...chart, colours: 'red' }]).ok).toBe(false);
    expect((suaCatalogDocument().components as Record<string, { required: string[] }>).VegaChart.required).toEqual(['component', 'spec']);
  });
  it("one written for A2UI's own vegachart catalog draws from sua's: its @catalogId goes", () => {
    const official = { ...chart, '@catalogId': 'https://a2ui.org/specification/v1_0/catalogs/vegachart/catalog.json' };
    expect(normalizeComponents([official])).toEqual([chart]);
    expect(validateViewComponents([{ id: 'root', component: 'Column', children: ['c'] }, official]).ok).toBe(true);
  });
});
