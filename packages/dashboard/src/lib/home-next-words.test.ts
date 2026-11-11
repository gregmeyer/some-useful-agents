import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyNextWords, nextKey, parseNextWords, wordedNext } from './home-next-words.js';
import type { HomeNext, NextItem } from './home-next.js';

// "Code picks, sua words it": the agent may reorder the list and write each why; code checks what it wrote.

const item = (key: string, over: Partial<NextItem> = {}): NextItem => ({ id: `next:run-agent:${key}`, kind: 'run-agent', title: `Run ${key}`, why: `code why for ${key}`, facts: [`agent: ${key}`, '6 times run in the last 30 days', 'last ran 3 days ago'], action: { label: 'Run it', post: `/home/try/${key}` }, score: 50, ...over });
const items = [item('weather'), item('news'), item('digest', { id: 'next:failing:digest', kind: 'failing', title: 'Digest keeps failing', facts: ['agent: Digest', '9 failed runs of 55 in the last 30 days'] })];
const answer = (v: unknown) => `Here you go.\n<next>\n${JSON.stringify(v)}\n</next>`;

describe("sua words Home's Next up", () => {
  it("takes the agent's order and each why that is one short line resting on that item's own facts", () => {
    const words = parseNextWords(answer({
      order: ['next:failing:digest', 'next:run-agent:weather', 'next:made-up:thing', 'next:failing:digest'],
      why: {
        'next:failing:digest': 'It failed 9 of its 55 runs, so your morning list is often missing.',
        'next:run-agent:weather': 'You have run it 12 times lately and not since Monday.',
        'next:run-agent:news': 'Great pick!',
        'next:made-up:thing': 'Not an item it was given, so not kept at all.',
      },
    }), items);
    expect(words).toEqual({
      // Unknown ids and repeats are dropped.
      order: ['next:failing:digest', 'next:run-agent:weather'],
      // 12 isn't in weather's facts; "Great pick!" is too short and shouts.
      why: { 'next:failing:digest': 'It failed 9 of its 55 runs, so your morning list is often missing.' },
    });
    expect(parseNextWords('no block here', items)).toBeUndefined();
    expect(parseNextWords('<next>not json</next>', items)).toBeUndefined();
    expect(parseNextWords(answer({ order: [], why: { 'next:run-agent:news': 'x'.repeat(141) } }), items)).toBeUndefined();
  });

  it('applies it: its order first, anything it left out after in code order, its why where it gave a good one', () => {
    const out = applyNextWords(items, { order: ['next:failing:digest'], why: { 'next:run-agent:news': 'It last ran 3 days ago and the week has moved on.' } });
    expect(out.map((x) => x.id)).toEqual(['next:failing:digest', 'next:run-agent:weather', 'next:run-agent:news']);
    expect(out.map((x) => x.why)).toEqual(['code why for digest', 'code why for weather', 'It last ran 3 days ago and the week has moved on.']);
    // The button and everything else stay as code made them.
    expect(out[0].action).toEqual(items[2].action);
    expect(applyNextWords(items, undefined)).toEqual(items);
    expect(nextKey(items)).toBe(nextKey([...items].reverse()));
    expect(nextKey(items)).not.toBe(nextKey(items.slice(0, 2)));
  });

  describe('on Home', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'home-next-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
    const ctxFor = (run: (inputs: Record<string, string>) => Promise<string | undefined>) => ({ dataDir: dir, activeRuns: new Map(), homeNextRun: run } as never as Parameters<typeof wordedNext>[0]);
    const next: HomeNext = { next: items, tidy: [] };

    it('shows the code version at once, asks the agent in the background, then shows the worded one; the same list is not asked again', async () => {
      const asked: Record<string, string>[] = [];
      const ctx = ctxFor(async (inputs) => { asked.push(inputs); return answer({ order: ['next:failing:digest', 'next:run-agent:news', 'next:run-agent:weather'], why: { 'next:failing:digest': 'It failed 9 of its 55 runs this month.' } }); });
      expect(wordedNext(ctx, next)).toEqual(next);
      await (ctx as { homeNextWork?: Promise<void> }).homeNextWork;
      expect(asked).toHaveLength(1);
      // It is given each item's id, kind, title and facts, and nothing else (no buttons, no scores).
      expect(JSON.parse(asked[0].ITEMS)[2]).toEqual({ id: 'next:failing:digest', kind: 'failing', title: 'Digest keeps failing', facts: ['agent: Digest', '9 failed runs of 55 in the last 30 days'] });
      const worded = wordedNext(ctx, next);
      expect(worded.next.map((x) => x.id)).toEqual(['next:failing:digest', 'next:run-agent:news', 'next:run-agent:weather']);
      expect(worded.next[0].why).toBe('It failed 9 of its 55 runs this month.');
      expect(worded.tidy).toEqual([]);
      expect(asked).toHaveLength(1);
      // The list changed: lines for items still on it are kept (in code's order) while it asks again.
      const changed: HomeNext = { next: [item('poem'), items[2]], tidy: [] };
      const meanwhile = wordedNext(ctx, changed);
      expect(meanwhile.next.map((x) => [x.id, x.why])).toEqual([['next:run-agent:poem', 'code why for poem'], ['next:failing:digest', 'It failed 9 of its 55 runs this month.']]);
      await (ctx as { homeNextWork?: Promise<void> }).homeNextWork;
      expect(asked).toHaveLength(2);
    });

    it('an agent that fails or answers badly leaves the code version, and is not asked again right away; one item needs no ordering', async () => {
      let n = 0;
      const ctx = ctxFor(async () => { n++; return n === 1 ? undefined : 'nonsense'; });
      expect(wordedNext(ctx, next)).toEqual(next);
      await (ctx as { homeNextWork?: Promise<void> }).homeNextWork;
      expect(wordedNext(ctx, next)).toEqual(next);
      expect(n).toBe(1);
      const one: HomeNext = { next: [items[0]], tidy: [] };
      expect(wordedNext(ctx, one)).toEqual(one);
      expect(n).toBe(1);
    });
  });
});
