import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent } from './agent-yaml.js';
import { withShellHelpers } from './node-spawner.js';

// The finder's `vet` step holds its plan to SEARCHES searches (2 to 5): a
// step that needs a few more options pays for fewer searches. An independent
// search (ADR-0081) keeps its place, last.
const here = dirname(fileURLToPath(import.meta.url));
const finder = parseAgent(readFileSync(join(here, '..', '..', '..', 'agents', 'examples', 'notebook-finder.yaml'), 'utf8'));
const vet = finder.nodes.find((n) => n.id === 'vet')!.command!;

const run = (searches: object[], env: Record<string, string> = {}) => JSON.parse(execFileSync('bash', ['-c', vet], {
  env: withShellHelpers({ PATH: process.env.PATH ?? '', UPSTREAM_PLAN_RESULT: JSON.stringify({ searches }), NOTEBOOK: 'Headphones', ...env }),
  encoding: 'utf8',
}).trim().split('\n').at(-1)!) as { searches: Array<{ where: string; independent?: boolean }> };

const five = ['A', 'B', 'C', 'D', 'E'].map((w) => ({ where: w, query: `${w} headphones`, why: 'x' }));

describe("the finder's search count", () => {
  it('keeps at most SEARCHES, 5 when unset, and never fewer than 2 or more than 5', () => {
    expect(run(five).searches.map((s) => s.where)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(run(five, { SEARCHES: '3' }).searches.map((s) => s.where)).toEqual(['A', 'B', 'C']);
    expect(run(five, { SEARCHES: '1' }).searches).toHaveLength(2);
    expect(run(five, { SEARCHES: '9' }).searches).toHaveLength(5);
    expect(run(five, { SEARCHES: 'lots' }).searches).toHaveLength(5);
  });

  it('keeps an independent search the plan made, in the last place', () => {
    const plan = [...five.slice(0, 2), { where: 'Indie', query: 'headphones review', why: 'independent', independent: true }, ...five.slice(2)];
    expect(run(plan, { SEARCHES: '3' }).searches.map((s) => s.where)).toEqual(['A', 'B', 'Indie']);
  });
});
