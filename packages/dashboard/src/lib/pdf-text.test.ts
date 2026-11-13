/**
 * Reading a PDF's text: the pages' own text comes back; a file with none,
 * or one that isn't a PDF, says why.
 */
import { describe, it, expect } from 'vitest';
import { pdfText } from './pdf-text.js';
import { makePdf } from './pdf-text.fixture.js';

describe('pdfText', () => {
  it('gives the text of every page, a blank line between pages', async () => {
    const out = await pdfText(makePdf([['Dana Rivers', 'Director of Partnerships at Riverbend Trust', 'January 2019 - Present (6 years)'], ['Education', 'State University, BA (2008 - 2012)']]));
    if ('error' in out) throw new Error(out.error);
    expect(out.pages).toBe(2);
    expect(out.text).toContain('Director of Partnerships at Riverbend Trust');
    expect(out.text).toContain('January 2019 - Present (6 years)');
    expect(out.text).toMatch(/6 years\)\n\nEducation/);
  });

  it('says why when there is no text to give', async () => {
    expect(await pdfText(new Uint8Array())).toEqual({ error: 'That file is empty.' });
    expect(await pdfText(new Uint8Array(Buffer.from('PK\u0003\u0004 a word file, not a pdf')))).toEqual({ error: "That isn't a PDF file." });
    // A page with nothing written on it (as a scan has): no text.
    expect(await pdfText(makePdf([[]]))).toMatchObject({ error: expect.stringContaining('has no text in it') });
    expect(await pdfText(new Uint8Array(Buffer.from('%PDF-1.4\nnot really one')))).toMatchObject({ error: expect.stringContaining("couldn't read that PDF") });
  });
});
