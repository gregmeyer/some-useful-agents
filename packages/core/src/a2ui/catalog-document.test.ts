import { describe, expect, it } from 'vitest';
import { Catalog, MessageProcessor, STRICT_VALIDATION } from '../../vendor/a2ui-web-core-v1.mjs';
import { SUA_CATALOG_ID, boardComponentDocs, suaCatalogComponentNames, suaCatalogDocument, suaComponentDocs } from './catalog.js';

describe('the sua catalog as an A2UI v1.0 catalog document (ADR-0085)', () => {
  const doc = suaCatalogDocument();
  const components = doc.components as Record<string, { description?: string; properties: Record<string, unknown>; required: string[]; examples?: unknown[] }>;

  it('says what it is, names every component, and stays small', () => {
    expect(doc).toMatchObject({ $id: SUA_CATALOG_ID, catalogId: SUA_CATALOG_ID, protocolVersion: '1.0', title: 'sua' });
    expect(String(doc.instructions)).toContain('{"@path": "/a/b"}');
    expect(Object.keys(components).sort()).toEqual([...suaCatalogComponentNames()].sort());
    expect(JSON.stringify(doc).length).toBeLessThan(120_000);
  });

  it("gives each of sua's components its props, a description and an example, bindings as $refs to the common types", () => {
    for (const d of [...suaComponentDocs(), ...boardComponentDocs()]) {
      const c = components[d.name];
      expect(c.description, d.name).toContain(d.summary);
      expect(c.examples, d.name).toEqual([d.example]);
      expect(c.properties.component, d.name).toEqual({ const: d.name });
    }
    expect(components.Metric.properties.value).toEqual({ $ref: 'common_types.json#/$defs/DynamicString' });
    expect(components.Metric.required).toEqual(['component', 'label', 'value']);
    expect(components.Grid.description).toMatch(/Board pages only\.$/);
  });

  it("A2UI's own loader reads it back, and a surface validates against what it loaded", () => {
    const loaded = Catalog.fromJson(doc, '1.0', SUA_CATALOG_ID);
    expect(loaded.components.size).toBe(Object.keys(components).length);
    const draw = (comps: unknown[]) => new MessageProcessor([loaded], undefined, { validationConfig: STRICT_VALIDATION })
      .processMessages([{ version: '1.0', createSurface: { surfaceId: 's', catalogId: SUA_CATALOG_ID, components: comps } }]);
    expect(() => draw([{ id: 'root', component: 'Column', children: ['m'] }, { id: 'm', component: 'Metric', label: 'Runs', value: { '@path': '/n' } }])).not.toThrow();
    expect(() => draw([{ id: 'root', component: 'Column', children: ['m'] }, { id: 'm', component: 'Metric', label: 'Runs', value: '4', nope: 1 }])).toThrow(/Unrecognized key/);
  });
});
