import { describe, it, expect } from 'vitest';
import { SHRINK_PICTURES, PDF_PICTURE_SCALE } from './browser.js';

// The script htmlToPdf runs in the page before printing. It is kept as text
// (core has no DOM types), so a typo would only show up as a 19 MB PDF.
describe('pictures in a PDF are shrunk to the size they are shown', () => {
  it('is a script that parses, and redraws oversized and WebP pictures as JPEG', async () => {
    const fn = new Function(`return (${SHRINK_PICTURES});`)() as (scale: number) => Promise<number>;
    expect(typeof fn).toBe('function');
    expect(PDF_PICTURE_SCALE).toBeGreaterThanOrEqual(2);
    // A page with one picture four times larger than shown, one WebP at its shown size, one small picture, one drawing.
    const drawn: Array<[number, number]> = [];
    const img = (src: string, nw: number, nh: number, w: number, h: number) => {
      const o: Record<string, unknown> = { currentSrc: src, naturalWidth: nw, naturalHeight: nh, getBoundingClientRect: () => ({ width: w, height: h }) };
      Object.defineProperty(o, 'src', { get: () => src, set: (v: string) => { src = v; (o.onload as (() => void) | undefined)?.(); } });
      return o as { src: string };
    };
    const big = img('data:image/jpeg;base64,AAAA', 2400, 1600, 200, 133);
    const webp = img('data:image/webp;base64,AAAA', 300, 200, 300, 200);
    const small = img('data:image/png;base64,AAAA', 300, 200, 200, 133);
    const art = img('data:image/svg+xml;base64,AAAA', 100, 100, 100, 100);
    (globalThis as Record<string, unknown>).document = {
      images: [big, webp, small, art],
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect: () => undefined, drawImage: (_i: unknown, _x: number, _y: number, w: number, h: number) => { drawn.push([w, h]); } }), toDataURL: () => 'data:image/jpeg;base64,SMALL' }),
    };
    try {
      expect(await fn(3)).toBe(2);
      expect(drawn).toEqual([[600, 400], [300, 200]]);
      expect(big.src).toBe('data:image/jpeg;base64,SMALL');
      expect(webp.src).toBe('data:image/jpeg;base64,SMALL');
      expect(small.src).toBe('data:image/png;base64,AAAA');
      expect(art.src).toBe('data:image/svg+xml;base64,AAAA');
    } finally {
      delete (globalThis as Record<string, unknown>).document;
    }
  });
});
