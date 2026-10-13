import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { viewAuthoringGuide, viewOutputNames } from './guide.js';
import { validateViewComponents } from './view.js';
import { suaComponentDocs } from './catalog.js';

describe('the view authoring guide', () => {
  it('has an example view that parses and validates', () => {
    const guide = viewAuthoringGuide();
    const block = /\nview:\n([\s\S]*?)\n\n/.exec(guide)![0];
    const parsed = parse(block) as { view: { components: unknown[] } };
    expect(validateViewComponents(parsed.view.components).ok).toBe(true);
  });

  it('lists the general sua components, briefly, without the notebook ones', () => {
    const guide = viewAuthoringGuide();
    for (const name of ['Metric', 'Table', 'Sparkline', 'KeyValue', 'StatStrip', 'ChipList']) expect(guide).toContain(`- ${name}: `);
    expect(guide).not.toContain('- OptionGrid: ');
    expect(suaComponentDocs().length).toBeGreaterThan(10);
    expect(guide.length).toBeLessThan(4500);
  });

  it('finds the top-level outputs a view binds', () => {
    expect(viewOutputNames([
      { id: 'root', component: 'Column', children: ['a', 'b'] },
      { id: 'a', component: 'Metric', label: 'x', value: { path: '/outputs/count' } },
      { id: 'b', component: 'Table', rows: { path: '/outputs/items/0/rows' }, columns: [] },
      { id: 'c', component: 'Sparkline', values: { path: '/series/count' } },
    ])).toEqual(['count', 'items']);
  });
});

describe('the guide\'s inputs + Run button recipe', () => {
  it('validates', () => {
    const comps = parse(`
- { id: root, component: Column, children: [city, run] }
- { id: city, component: TextField, label: City, value: { path: /inputs/CITY } }
- { id: run, component: Button, child: run_label, action: { event: { name: run-agent, context: { in_CITY: { path: /inputs/CITY } } } } }
- { id: run_label, component: Text, text: Run }
`) as unknown[];
    const v = validateViewComponents(comps);
    expect(v.ok ? [] : v.errors).toEqual([]);
  });
});
