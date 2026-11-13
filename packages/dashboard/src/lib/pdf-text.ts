/**
 * The text of a PDF you hand a notebook in place of pasting (a profile
 * saved from LinkedIn, a résumé): its pages' text in reading order, a blank
 * line between pages. Only text that is in the file: a scan (pictures of
 * pages) has none, and says so; nothing is read off the pictures.
 */
import { extractText, getDocumentProxy } from 'unpdf';

/** The largest PDF read, and the most pages. */
export const PDF_MAX_BYTES = 15 * 1024 * 1024;
export const PDF_MAX_PAGES = 60;

export type PdfText = { text: string; pages: number } | { error: string };

/** The PDF's text, or why there isn't any. Never throws. */
export async function pdfText(bytes: Uint8Array): Promise<PdfText> {
  if (!bytes.length) return { error: 'That file is empty.' };
  if (bytes.length > PDF_MAX_BYTES) return { error: 'That PDF is larger than 15 MB. Paste its text here.' };
  // "%PDF-" within the first kilobyte (some files lead with a few stray bytes).
  if (!Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes('%PDF-')) return { error: 'That isn\'t a PDF file.' };
  try {
    // A copy: the reader takes the buffer it's given.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    if (pdf.numPages > PDF_MAX_PAGES) return { error: `That PDF has ${String(pdf.numPages)} pages; sua reads up to ${String(PDF_MAX_PAGES)}. Paste the part that matters here.` };
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const all = text.map((t) => t.replace(/[ \t]+\n/g, '\n').trim()).filter(Boolean).join('\n\n').trim();
    if (all.replace(/\s+/g, '').length < 20) return { error: 'That PDF has no text in it (it may be a scan: pictures of pages). Paste the text here.' };
    return { text: all, pages: totalPages };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'PasswordException') return { error: 'That PDF is locked with a password. Save a copy without one, or paste its text here.' };
    return { error: 'sua couldn\'t read that PDF. Paste its text here.' };
  }
}
