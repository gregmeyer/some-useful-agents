import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pictures in views show whole, scaled to fit their frame: a tall photo in a
// wide frame (a guitar on a card) used to be cut down to a strip, or to
// stretch its card. Only generated art and 16:9 video thumbnails still fill.
const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, '..', ...p), 'utf8');

describe('pictures fit their frames', () => {
  it('no photo frame crops (object-fit: cover only on generated art and video thumbnails)', () => {
    const sources = { 'notebooks.css': read('assets', 'notebooks.css'), 'inbox.css': read('assets', 'inbox.css'), 'pulse.css': read('assets', 'pulse.css'), 'a2ui-sua.js': read('assets', 'a2ui-sua.js'), 'pulse-renderers.ts': read('views', 'pulse-renderers.ts') };
    const covers = Object.entries(sources).flatMap(([f, s]) => s.split('\n').filter((l) => /object-fit:\s*cover/.test(l)).map((l) => `${f}: ${l.trim().slice(0, 60)}`));
    expect(covers).toEqual([
      'notebooks.css: .nbl-card__art { object-fit: cover; }',
      'inbox.css: .nbs-card__cover svg { object-fit: cover; }',
      expect.stringMatching(/^pulse-renderers\.ts: .*thumbUrl/), // a YouTube thumbnail: always 16:9
    ]);
  });

  it('a card photo is pinned in its frame, so a tall one cannot stretch the card', () => {
    expect(read('assets', 'a2ui-sua.js')).toMatch(/\.pic img \{ position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;/);
    expect(read('assets', 'notebooks.css')).toMatch(/\.nbo-hero__pic img \{ position: absolute; inset: 0; [^}]*object-fit: contain;/);
  });

  it('any other picture scales down to its column, without outranking a class that sizes it', () => {
    const base = read('assets', 'base.css');
    expect(base).toContain('img { max-width: 100%; }');
    expect(base).toContain(':where(img:not([height])) { height: auto; }');
  });
});
