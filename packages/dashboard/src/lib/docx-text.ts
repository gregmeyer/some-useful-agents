/**
 * The text of a Word file (.docx) you hand sua in place of pasting: its
 * paragraphs in order, a line each. A .docx is a zip with the document as
 * XML inside (word/document.xml); this reads that one entry with node's own
 * zlib (no zip library) and takes the text runs. Headers, footers, comments
 * and text inside pictures are not read. An old .doc is not a zip and is
 * refused.
 */
import { inflateRawSync } from 'node:zlib';

/** The largest Word file read, and the most its document may unpack to. */
export const DOCX_MAX_BYTES = 15 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 40 * 1024 * 1024;

export type DocxText = { text: string; paragraphs: number } | { error: string };

/** One entry of a zip, unpacked: found through the central directory at the file's end. */
function zipEntry(buf: Buffer, name: string): Buffer | undefined {
  // End of central directory: its signature within the last 64 KB (a comment may follow it).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return undefined;
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && at + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) return undefined;
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const entry = buf.toString('utf8', at + 46, at + 46 + nameLen);
    if (entry === name) {
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return undefined;
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data, { maxOutputLength: DOCUMENT_MAX_BYTES });
      return undefined;
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  return undefined;
}

const entities = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'')
  .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');

/** The document XML's text: each paragraph a line; tabs and line breaks kept. Pure. */
export function docxXmlText(xml: string): { text: string; paragraphs: number } {
  let out = '';
  let paragraphs = 0;
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>/g)) {
    if (m[1] !== undefined) out += entities(m[1]);
    else if (m[0].startsWith('<w:tab')) out += '\t';
    else if (m[0] === '</w:p>') { out += '\n'; paragraphs++; }
    else out += '\n';
  }
  return { text: out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), paragraphs };
}

/** The Word file's text, or why there isn't any. Never throws. */
export function docxText(bytes: Uint8Array): DocxText {
  if (!bytes.length) return { error: 'That file is empty.' };
  if (bytes.length > DOCX_MAX_BYTES) return { error: 'That Word file is larger than 15 MB. Paste its text here.' };
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // A zip starts "PK"; an old .doc doesn't.
  if (buf.length < 30 || buf.readUInt16LE(0) !== 0x4b50) return { error: 'That isn\'t a .docx file (an older .doc can\'t be read: save it as .docx or PDF first).' };
  try {
    const doc = zipEntry(buf, 'word/document.xml');
    if (!doc) return { error: 'That file has no Word document in it. Save it as .docx or PDF again, or paste its text here.' };
    const read = docxXmlText(doc.toString('utf8'));
    if (read.text.replace(/\s+/g, '').length < 20) return { error: 'That Word file has no text in it (it may be pictures of pages). Paste the text here.' };
    return read;
  } catch {
    return { error: 'sua couldn\'t read that Word file. Save it as PDF, or paste its text here.' };
  }
}
