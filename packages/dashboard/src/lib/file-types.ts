/**
 * The kinds of file sua takes right now (Settings → General → Files sua
 * takes), for the views that draw a file picker. Views are plain functions
 * with no store to ask, so the app sets this from the store on each request
 * (index.ts) and the pickers read it.
 */
import { DEFAULT_ATTACH_FILE_TYPES, attachAccept, attachFileWords } from '@some-useful-agents/core';

let current: string[] = [...DEFAULT_ATTACH_FILE_TYPES];

export function setCurrentFileTypes(exts: readonly string[]): void { current = [...exts]; }

/** The allowed extensions, the `accept` for a file input, and the kinds in words. */
export function currentFileTypes(): { exts: string[]; accept: string; words: string } {
  return { exts: [...current], accept: attachAccept(current), words: attachFileWords(current) };
}
