/**
 * Budgeted prompt blocks, shared by every place sua replays history or
 * recalls notes into a prompt: agent conversations (sessions.ts), agent
 * memory recall (memory-store.ts), and the inbox triage thread + learnings
 * (dashboard inbox-shared.ts). One budget rule instead of three: keep what
 * matters most, measure in bytes, and say when something was left out.
 */

/**
 * Keep the most recent lines that fit in `maxBytes` (oldest dropped first),
 * returned oldest first. A line longer than `lineMaxChars` is cut. Each
 * line costs its bytes plus a newline.
 */
export function budgetTranscript(
  lines: readonly string[],
  opts: { maxBytes: number; lineMaxChars?: number },
): { lines: string[]; dropped: number } {
  const kept: string[] = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    let line = lines[i];
    if (opts.lineMaxChars !== undefined && line.length > opts.lineMaxChars) {
      line = `${line.slice(0, opts.lineMaxChars)} …(cut)`;
    }
    const size = Buffer.byteLength(line) + 1;
    if (bytes + size > opts.maxBytes) return { lines: kept, dropped: i + 1 };
    kept.unshift(line);
    bytes += size;
  }
  return { lines: kept, dropped: 0 };
}

/** "(3 earlier turns left out for length)", or '' when nothing was dropped. */
export function droppedNote(dropped: number, unit = 'turn', plural = `${unit}s`): string {
  return dropped > 0 ? `(${dropped} earlier ${dropped === 1 ? unit : plural} left out for length)` : '';
}

/**
 * Keep lines in the given (priority) order until the next one would pass
 * `maxBytes`. For ranked lists (recalled memories, learnings), where the
 * first entries matter most.
 */
export function takeWithinBudget(lines: readonly string[], maxBytes: number): string[] {
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const size = Buffer.byteLength(line) + 1;
    if (bytes + size > maxBytes) break;
    kept.push(line);
    bytes += size;
  }
  return kept;
}
