/**
 * The kinds of file sua takes where you'd otherwise paste (a notebook's
 * "Add a file or paste", the paperclip on a message). Only a file's text is
 * kept, so the list is the kinds sua can read text from; which of them are
 * allowed is a setting (Settings → General → Files sua takes).
 */

export interface AttachFileType {
  /** Its extension, lowercase, no dot: also its id in the setting. */
  ext: string;
  /** For the settings list ("Word (.docx)"). */
  label: string;
  /** In a sentence ("Word (.docx)"). */
  word: string;
  mime: string[];
  /** Where its text is read: on the server (a PDF, a Word file) or in the browser (plain text). */
  read: 'server' | 'browser';
}

export const ATTACH_FILE_TYPES: readonly AttachFileType[] = [
  { ext: 'pdf', label: 'PDF (.pdf)', word: 'PDF', mime: ['application/pdf'], read: 'server' },
  { ext: 'txt', label: 'Plain text (.txt)', word: 'plain text (.txt)', mime: ['text/plain'], read: 'browser' },
  { ext: 'md', label: 'Markdown (.md)', word: 'Markdown (.md)', mime: ['text/markdown'], read: 'browser' },
  { ext: 'docx', label: 'Word (.docx)', word: 'Word (.docx)', mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], read: 'server' },
];

/** Allowed until you change it: every kind sua can read. */
export const DEFAULT_ATTACH_FILE_TYPES: readonly string[] = ATTACH_FILE_TYPES.map((t) => t.ext);

/** A stored or posted list as extensions sua knows, in its own order, each once. Not a list: the default. Pure. */
export function cleanAttachFileTypes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_ATTACH_FILE_TYPES];
  const want = new Set(raw.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase().replace(/^\./, '')));
  return ATTACH_FILE_TYPES.filter((t) => want.has(t.ext)).map((t) => t.ext);
}

const known = (exts: readonly string[]) => ATTACH_FILE_TYPES.filter((t) => exts.includes(t.ext));

/** A file input's `accept` for the allowed kinds. Pure. */
export function attachAccept(exts: readonly string[]): string {
  return known(exts).flatMap((t) => [`.${t.ext}`, ...t.mime]).join(',');
}

/** The allowed kinds in a sentence: "PDF, plain text (.txt), Markdown (.md) or Word (.docx)". Pure. */
export function attachFileWords(exts: readonly string[]): string {
  const w = known(exts).map((t) => t.word);
  return w.length <= 1 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} or ${w[w.length - 1]}`;
}

/** The kind a content type is, when it's one read on the server. Pure. */
export function attachTypeOfMime(mime: string | undefined): AttachFileType | undefined {
  const m = (mime ?? '').split(';')[0].trim().toLowerCase();
  return ATTACH_FILE_TYPES.find((t) => t.read === 'server' && t.mime.includes(m));
}
