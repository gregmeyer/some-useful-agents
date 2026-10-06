import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore, NotebookStore, notebookViewData } from '@some-useful-agents/core';
import { applyPictures, smallerImageUrl } from './notebook-pictures.js';

let dir: string;
let runs: RunStore;
afterEach(() => { try { runs?.close(); } catch { /* ignore */ } if (dir) rmSync(dir, { recursive: true, force: true }); });

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

describe('representative pictures', () => {
  it('keeps found images and sanitized drawings with their kind, and marks every asked option tried', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-pics-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Car' }).id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    const add = (t: string) => s.upsertOption(nb.id, { title: t, by: 'agent:x', data: { price: 4000 } }).entry;
    const rav = add('2010 Toyota RAV4'); const fo = add('2009 Subaru Forester'); const xt = add('2009 Forester XT'); const cx = add('2012 Mazda CX-5');
    expect(s.pictureCandidates(nb.id).map((e) => e.id).sort()).toEqual([rav.id, fo.id, xt.id, cx.id].sort());
    const fetched: string[] = [];
    let flaky = 0;
    const deps = { fetchImage: async (u: string) => {
      fetched.push(u);
      if (u.includes('broken')) throw new Error('HTTP 404');
      if (u.includes('busy') && flaky++ === 0) throw new Error('HTTP 429');
      return { bytes: JPEG, contentType: 'image/jpeg' };
    } };
    const raw = `<pictures>${JSON.stringify({ items: [
      { id: rav.id, url: 'https://upload.wikimedia.org/x/RAV4.jpg', what: 'Wikimedia photo of a 2010 RAV4' },
      { id: fo.id, svg: '<svg viewBox="0 0 320 240"><rect width="9" height="9"/></svg>', what: 'a model drawing (ignored)' },
      { id: xt.id, url: 'https://cars.example/broken.jpg' },
      { id: cx.id, url: 'https://cars.example/busy.jpg' },
      { id: 'not-asked', url: 'https://x.example/a.jpg' },
    ] })}</pictures>`;
    const out = await applyPictures(s, nb.id, [rav.id, fo.id, xt.id, cx.id], raw, deps, [0]);
    expect(out).toEqual({ kept: 4, found: 2, drawn: 2 });
    expect(fetched).toEqual(['https://upload.wikimedia.org/x/RAV4.jpg', 'https://cars.example/broken.jpg', 'https://cars.example/busy.jpg', 'https://cars.example/busy.jpg']);
    expect(s.photo(rav.id)).toMatchObject({ kind: 'representative', what: 'Wikimedia photo of a 2010 RAV4', contentType: 'image/jpeg' });
    expect(s.photo(cx.id)!.kind).toBe('representative');   // retried after a 429
    expect(s.photo(fo.id)!.kind).toBe('illustration');     // a model's SVG isn't used: sua draws it
    expect(s.photo(xt.id)!.kind).toBe('illustration');     // fetch failed: drawn
    expect(s.pictureCandidates(nb.id)).toEqual([]);         // all four tried today
    // A day later, the drawn ones get another try at a real photo.
    runs.databaseHandle().prepare('UPDATE notebook_entries SET picture_tried_at = ? WHERE id IN (?, ?)').run('2000-01-01T00:00:00Z', fo.id, rav.id);
    expect(s.pictureCandidates(nb.id).map((e) => e.id)).toEqual([fo.id]);
    const v = notebookViewData(s.get(nb.id)!, s.entries(nb.id), s).notebook.options;
    expect(v.find((o) => o.id === rav.id)).toMatchObject({ imageKind: 'representative', image: `/notebooks/car/entries/${rav.id}/photo` });
  });
});

describe('smallerImageUrl', () => {
  it('asks Wikimedia for a 500px thumbnail, and leaves other addresses alone', () => {
    expect(smallerImageUrl('https://upload.wikimedia.org/wikipedia/commons/0/02/2008_Toyota_RAV4_XTR_D4-D_2.2_Front.jpg'))
      .toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/2008_Toyota_RAV4_XTR_D4-D_2.2_Front.jpg/500px-2008_Toyota_RAV4_XTR_D4-D_2.2_Front.jpg');
    expect(smallerImageUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/A.jpg/500px-A.jpg')).toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/A.jpg/500px-A.jpg');
    expect(smallerImageUrl('https://cars.example/a.jpg')).toBe('https://cars.example/a.jpg');
  });
});

describe('sua\'s own illustrations', () => {
  it('draws the right thing for the option, tinted per option, with its name escaped', async () => {
    const { optionIllustration, illustrationKind } = await import('./notebook-illustrations.js');
    expect(illustrationKind({ title: 'Buy a used car', statement: '' }, '2010 Toyota RAV4')).toBe('car');
    expect(illustrationKind({ title: 'Find a staff role', statement: '' }, 'Staff Engineer, Stripe')).toBe('job');
    expect(illustrationKind({ title: 'Guitar hunt', statement: '' }, 'Ibanez Talman')).toBe('music');
    const car = optionIllustration({ kind: 'car', name: '2010 Toyota RAV4 <b>', seed: 'a' });
    expect(car).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(car).toContain('2010 Toyota RAV4 &lt;b&gt;');
    expect(car).not.toMatch(/<script|href=|url\(http/);
    expect(optionIllustration({ kind: 'job', name: 'Staff Engineer, Stripe', seed: 'b' })).toContain('>S</text>');
    expect(optionIllustration({ kind: 'car', name: 'x', seed: 'a' })).not.toBe(optionIllustration({ kind: 'car', name: 'x', seed: 'zz' }));
  });
});
