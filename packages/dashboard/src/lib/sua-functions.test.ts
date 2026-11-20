import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUA_FUNCTION_NAMES, suaCatalog, validateViewComponents } from '@some-useful-agents/core';

// A browser module (assets/sua-functions.js); a computed path keeps tsc from typing it.
const here = dirname(fileURLToPath(import.meta.url));
type Fn = { name: string; returnType: string; schema: { shape: Record<string, unknown> }; execute: (a: Record<string, unknown>) => unknown };
const mod = await import(join(here, '..', 'assets', 'sua-functions.js')) as {
  joinWords: (l: unknown, sep?: string, last?: string) => string;
  relativeWords: (iso: unknown, now?: number) => string;
  rangeWords: (min: unknown, max: unknown, currency?: string) => string;
  suaFunctions: (z: unknown, cs: unknown) => Fn[];
};

describe("sua's A2UI functions (ADR-0087)", () => {
  it('join, relativeTime and formatRange say things as a person would', () => {
    expect(mod.joinWords(['hotel', 'rental', 'villa'])).toBe('hotel, rental, villa');
    expect(mod.joinWords(['hotel', 'rental', 'villa'], ', ', ' and ')).toBe('hotel, rental and villa');
    expect(mod.joinWords('solo')).toBe('solo');
    expect(mod.joinWords([])).toBe('');
    const now = Date.parse('2026-11-20T12:00:00Z');
    expect(mod.relativeWords('2026-11-17T12:00:00Z', now)).toBe('3 days ago');
    expect(mod.relativeWords('2026-11-20T14:00:00Z', now)).toBe('in 2 hours');
    expect(mod.relativeWords('2026-11-20T11:59:50Z', now)).toBe('just now');
    expect(mod.relativeWords('not a date', now)).toBe('');
    expect(mod.rangeWords(120000, 140000, 'USD')).toBe('$120K–$140K');
    expect(mod.rangeWords(120, 140)).toBe('120–140');
    expect(mod.rangeWords(90, 90, 'USD')).toBe('$90');
    expect(mod.rangeWords(undefined, '45000', 'USD')).toBe('$45K');
  });

  it('the server validates the same functions, by the same names and args, as the browser runs', () => {
    const cat = suaCatalog() as unknown as { functions: Map<string, { schema: { shape: Record<string, unknown> } }> };
    const z = { object: (shape: Record<string, unknown>) => ({ shape, strict: () => ({ shape }) }), string: () => ({ optional: () => ({}) }) };
    const browser = mod.suaFunctions(z, { DynamicValue: {}, DynamicString: {} });
    expect(browser.map((f) => f.name)).toEqual([...SUA_FUNCTION_NAMES]);
    for (const f of browser) expect([f.name, Object.keys(f.schema.shape)]).toEqual([f.name, Object.keys(cat.functions.get(f.name)!.schema.shape)]);
    expect(browser.find((f) => f.name === 'count')!.execute({ value: [1, 2, 3] })).toBe(3);
  });

  it('a view may call them (in a formatString too); an unknown one, or an unknown arg, is refused', () => {
    const v = (text: unknown) => validateViewComponents([{ id: 'root', component: 'Column', children: ['t'] }, { id: 't', component: 'Text', text }]);
    expect(v({ call: 'join', args: { value: { path: '/kinds' }, last: ' and ' } }).ok).toBe(true);
    expect(v({ call: 'formatString', args: { value: '${count(value:${/options})} in the running' } }).ok).toBe(true);
    expect(v({ call: 'noSuchFn', args: {} })).toMatchObject({ ok: false, errors: ["Unrecognized function 'noSuchFn'"] });
    expect(v({ call: 'formatRange', args: { min: 1, max: 2, bogus: 1 } }).ok).toBe(false);
  });
});
