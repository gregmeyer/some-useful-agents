/**
 * A picture added to the answer (an artboard drawn for it) on the TL;DR
 * picture: it joins the card's photos, leads when it's newer than the photo
 * chosen for the notebook, and is shown whole, credited as drawn.
 */
import { describe, it, expect } from 'vitest';
import { cleanTldrSpec, type Notebook } from '@some-useful-agents/core';
import { illustrationTldrPhoto, tldrBigPicture, tldrCard, tldrData, tldrViewData, type TldrPhoto } from './notebook-tldr.js';
import { cardForAgent } from '../lib/notebook-tldr-redraw.js';
import { render } from './html.js';

const at = '2026-11-20T00:00:00.000Z';
const nb = (over: Partial<Notebook> = {}): Notebook => ({
  id: 'nb', title: 'Learn to make a PB&J', statement: '', params: [], criteria: [], pipeline: [], stages: [], checks: [], cadence: '', status: 'active', fields: [],
  answer: { question: 'How?', text: 'Spread, then close it.', confidence: 'high', findings: [{ text: 'Wash your hands first.', from: [] }], open: [], at, by: 'agent:notebook-writer' },
  createdAt: at, updatedAt: at, ...over,
} as Notebook);
const artboard = illustrationTldrPhoto({ src: '/notebooks/nb/entries/e9/photo', title: 'PB&J in Six Steps', by: 'Artboard illustrator', at: '2026-11-27T00:00:00.000Z' });
const chosen: TldrPhoto = { src: '/notebooks/nb/photo', credit: 'Wikimedia Commons', name: 'A sandwich' };
const photo = (when: string) => ({ image: 'https://x.example/a.jpg', credit: 'Wikimedia Commons', at: when });

describe('an illustration on the TL;DR picture', () => {
  it('with no chosen photo it leads, framed as an illustration', () => {
    const t = tldrData(nb(), [], undefined, undefined, undefined, undefined, [artboard]);
    expect(t.photos).toEqual([artboard]);
    expect(tldrBigPicture(t)).toEqual({ src: artboard.src, kind: 'illustration' });
    // Without one, nothing changes.
    expect(tldrData(nb(), []).photos).toBeUndefined();
  });

  it('whichever was put there last leads: a newer illustration before the chosen photo, an older one after it', () => {
    const older = tldrData(nb({ photo: photo('2026-11-22T00:00:00.000Z') }), [], undefined, undefined, undefined, chosen, [artboard]);
    expect(older.photos?.map((x) => x.src)).toEqual([artboard.src, chosen.src]);
    const newer = tldrData(nb({ photo: photo('2026-11-28T00:00:00.000Z') }), [], undefined, undefined, undefined, chosen, [artboard]);
    expect(newer.photos?.map((x) => x.src)).toEqual([chosen.src, artboard.src]);
    expect(tldrBigPicture(newer)).toEqual({ src: chosen.src, kind: 'photo' });
  });

  it('a cover shows it whole on white, credited as drawn; the standard card puts it in the strip', () => {
    const t = tldrData(nb(), [], undefined, undefined, undefined, undefined, [artboard]);
    const cover = render(tldrCard(t, { spec: cleanTldrSpec({ layout: 'cover', size: 'standard' })! }));
    expect(cover).toContain(`<span class="tl__frame is-illustration"><img src="${artboard.src}" alt="">`);
    expect(cover).toContain('<span class="tl__artcredit">Drawn by Artboard illustrator</span>');
    expect(cover).not.toContain('Photo: Artboard');
    const standard = render(tldrCard(t));
    expect(standard).toContain(`<li class="tl__shot"><span class="tl__frame is-illustration"><img src="${artboard.src}" alt="PB&amp;J in Six Steps">`);
  });

  it("a composed view's photo cover draws it whole with the words under it, and the redraw agent is told what it is", () => {
    const t = tldrData(nb(), [], undefined, undefined, undefined, undefined, [artboard]);
    const spec = cleanTldrSpec({
      size: 'landscape', tone: 'editorial', layout: 'stack', headline: 'A PB&J in two minutes',
      view: [
        { id: 'root', component: 'Columns', children: ['cover', 'details'], widths: [5, 7] },
        { id: 'cover', component: 'PhotoCover', photo: { path: '/tldr/photos/0' }, headline: { path: '/tldr/headline' }, scrim: 'dark', align: 'bottom', height: 'tall' },
        { id: 'details', component: 'Column', children: ['lead'] },
        { id: 'lead', component: 'TldrPart', part: 'lead' },
      ],
    })!;
    expect(spec.view?.length).toBeGreaterThan(0);
    expect((tldrViewData(t, spec, 'today').photos as TldrPhoto[])[0]).toMatchObject({ kind: 'illustration' });
    const out = render(tldrCard(t, { spec }));
    expect(out).toMatch(/<section class="tlv__cover is-tall at-bottom scrim-dark is-drawn">/);
    expect(out).toContain('<span class="tlv__credit">Drawn by Artboard illustrator</span>');
    const each = (cardForAgent(t).photos as { each: Array<{ kind?: string }> }).each;
    expect(each[0].kind).toMatch(/^illustration/);
  });
});
