import { describe, it, expect } from 'vitest';
import { render } from './html.js';
import { miniDag, describeDag, type MiniDagNode } from './mini-dag.js';

const chain: MiniDagNode[] = [
  { id: 'a', type: 'llm-prompt' },
  { id: 'b', dependsOn: ['a'], type: 'llm-prompt' },
  { id: 'c', dependsOn: ['b'], type: 'shell' },
];

const fanOut: MiniDagNode[] = [
  { id: 'plan', type: 'llm-prompt' },
  { id: 'left', dependsOn: ['plan'], type: 'llm-prompt', tools: ['web-fetch'] },
  { id: 'right', dependsOn: ['plan'], type: 'llm-prompt', tools: ['web-fetch'] },
  { id: 'merge', dependsOn: ['left', 'right'], type: 'llm-prompt' },
];

const conditional: MiniDagNode[] = [
  { id: 'fetch', type: 'llm-prompt' },
  { id: 'judge', dependsOn: ['fetch'], type: 'llm-prompt' },
  { id: 'alert', dependsOn: ['judge'], type: 'llm-prompt', conditional: true, condition: 'judge.verdict = YES' },
];

const cx = (svg: string): number[] =>
  [...svg.matchAll(/<circle cx="([\d.]+)"[^>]*class="mini-dag__node/g)].map((m) => Number(m[1]));

describe('miniDag', () => {
  it('renders nothing for a single-node agent', () => {
    // One dot communicates nothing worth the horizontal space.
    expect(render(miniDag([{ id: 'only' }])).trim()).toBe('');
    expect(render(miniDag([])).trim()).toBe('');
  });

  it('lays a chain out strictly left to right', () => {
    const xs = cx(render(miniDag(chain)));
    expect(xs).toHaveLength(3);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });

  it('stacks parallel branches in one column so a fan-out looks like a fan-out', () => {
    const svg = render(miniDag(fanOut));
    const circles = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"[^>]*class="mini-dag__node/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

    const byColumn = new Map<number, number>();
    for (const c of circles) byColumn.set(c.x, (byColumn.get(c.x) ?? 0) + 1);
    // plan | left+right | merge  → the middle column holds two.
    expect([...byColumn.values()].filter((n) => n === 2)).toHaveLength(1);
    expect(byColumn.size).toBe(3);
  });

  it('draws one edge per dependency', () => {
    const svg = render(miniDag(fanOut));
    // plan→left, plan→right, left→merge, right→merge
    expect([...svg.matchAll(/<line /g)]).toHaveLength(4);
  });

  it('marks a conditional node and its incoming edge as dashed', () => {
    const svg = render(miniDag(conditional));
    expect(svg).toContain('mini-dag__node--cond');
    expect(svg).toContain('mini-dag__edge--cond');
  });

  it('gives every node a hover tooltip naming its position, type and wiring', () => {
    const svg = render(miniDag(fanOut));
    expect(svg).toContain('<title>1. plan · llm-prompt · starts the run</title>');
    expect(svg).toContain('2. left · llm-prompt · tools: web-fetch · after plan');
    expect(svg).toContain('4. merge · llm-prompt · after left + right');
  });

  it('spells out the guard on a conditional node', () => {
    const svg = render(miniDag(conditional));
    expect(svg).toContain('runs only if judge.verdict = YES');
  });

  it('does not put role="img" on the root — it suppresses per-node tooltips', () => {
    // Regression guard. `role="img"` (and aria-label) collapse the SVG into a
    // single graphical object; the browser then uses the root label for the
    // whole thing and never shows the per-node <title>. Symptom is subtle:
    // you get the `cursor: help` on hover and no tooltip at all. Someone will
    // want to add this back for accessibility — the root <title> below is the
    // accessible name, and it doesn't break hover.
    const svg = render(miniDag(chain, { title: 'Chain: 3 steps' }));
    expect(svg).not.toContain('role="img"');
    expect(svg).not.toContain('aria-label');
    expect(svg).toContain('<title>Chain: 3 steps</title>');
  });

  it('gives each node an oversized invisible hit target', () => {
    // A 5px dot is a mean thing to ask a mouse to hit.
    const svg = render(miniDag(chain));
    expect(svg).toContain('mini-dag__hitarea');
    expect([...svg.matchAll(/mini-dag__hitarea/g)]).toHaveLength(3);
  });

  it('summarizes instead of drawing mush past a dozen nodes', () => {
    const many: MiniDagNode[] = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      dependsOn: i === 0 ? undefined : [`n${i - 1}`],
    }));
    const out = render(miniDag(many));
    expect(out).toContain('20 steps');
    expect(out).not.toContain('<svg');
  });

  it('survives a dependency cycle rather than hanging', () => {
    // Agent YAML is validated as a DAG upstream, but this view must never
    // be the thing that spins forever on bad data.
    const cyclic: MiniDagNode[] = [
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
    ];
    expect(() => render(miniDag(cyclic))).not.toThrow();
  });

  it('ignores dependencies on nodes that are not present', () => {
    const dangling: MiniDagNode[] = [
      { id: 'a' },
      { id: 'b', dependsOn: ['a', 'ghost'] },
    ];
    const svg = render(miniDag(dangling));
    expect([...svg.matchAll(/<line /g)]).toHaveLength(1);
  });
});

describe('describeDag', () => {
  it('describes a plain chain by length alone', () => {
    expect(describeDag(chain)).toBe('3 steps');
  });

  it('calls out parallelism', () => {
    expect(describeDag(fanOut)).toBe('4 steps · 2 in parallel');
  });

  it('calls out conditional steps', () => {
    expect(describeDag(conditional)).toBe('3 steps · 1 conditional');
  });

  it('singularizes a one-step agent', () => {
    expect(describeDag([{ id: 'only' }])).toBe('1 step');
  });
});
