import { describe, it, expect } from 'vitest';
import { keeperParts } from './keeper-parts.js';

const item = (i: number, size = 300) => ({ subject: `Option ${String(i)}`, status: 'done', found: { warranty: { value: `${String(i)} months. ${'x'.repeat(size)}`, source: `https://example.com/${String(i)}` } } });
const body = (part: string) => JSON.parse(part.slice(part.indexOf('\n') + 1)) as { headline?: string; table?: unknown; results: Array<{ subject: string }> };

describe("a run's output, in parts the keeper can read whole", () => {
  it('an output that fits is one part, untouched', () => {
    expect(keeperParts('short', 100)).toEqual(['short']);
    const json = JSON.stringify({ results: [item(1), item(2)] });
    expect(keeperParts(json, 12_000)).toEqual([json]);
  });

  it('a long list is split where its items end: every item is in exactly one part, each part fits, and says which part it is', () => {
    const results = Array.from({ length: 8 }, (_, i) => item(i + 1, 2500));
    const output = JSON.stringify({ headline: '8 of 8 researched.', count: 8, results, table: { rows: results } });
    expect(output.length).toBeGreaterThan(40_000);
    const parts = keeperParts(output, 12_000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].startsWith(`(part 1 of ${String(parts.length)} of this output)\n`)).toBe(true);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(12_100);
    expect(parts.flatMap((p) => body(p).results.map((r) => r.subject))).toEqual(results.map((r) => r.subject));
    // Small things beside the list ride along; a large copy of the same rows doesn't.
    expect(body(parts[1]).headline).toBe('8 of 8 researched.');
    expect(body(parts[0]).table).toBeUndefined();
  });

  it('a bare list splits the same way; text splits at paragraphs', () => {
    const list = keeperParts(JSON.stringify([item(1, 700), item(2, 700), item(3, 700)]), 1000);
    expect(list).toHaveLength(3);
    expect(JSON.parse(list[2].slice(list[2].indexOf('\n') + 1))).toEqual([item(3, 700)]);
    const text = keeperParts(['one '.repeat(100), 'two '.repeat(100), 'three '.repeat(100)].join('\n\n'), 1000);
    expect(text).toHaveLength(2);
    expect(text[0]).toContain('one one');
    expect(text[0]).toContain('two two');
    expect(text[0]).not.toContain('three');
    expect(text[1]).toContain('three three');
  });

  it('past the most parts it reads, the last one says how much was left out; one item too long for a part is cut and says so', () => {
    const many = keeperParts(JSON.stringify(Array.from({ length: 10 }, (_, i) => item(i + 1, 900))), 1000, 3);
    expect(many).toHaveLength(3);
    expect(many[2]).toContain('(7 more parts of this output not shown)');
    const huge = keeperParts(JSON.stringify([item(1, 5000), item(2, 10)]), 1000);
    expect(huge[0]).toContain('(truncated)');
    expect(huge[1]).toContain('Option 2');
  });
});
