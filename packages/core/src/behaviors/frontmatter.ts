/**
 * Split `BEHAVIOR.md` into its YAML frontmatter and Markdown body.
 *
 * Deliberately hand-rolled rather than pulled from a dependency: the rule is
 * three lines long, and we need `yamlStartLine` so a YAML parse error can be
 * reported at its real line in the file rather than at line 1 of a substring.
 */

export interface FrontmatterSplit {
  /** Raw YAML text between the fences (no fences). */
  yaml: string;
  /** 1-based line number in the ORIGINAL file where `yaml` begins. */
  yamlStartLine: number;
  /** Everything after the closing fence. */
  body: string;
}

/** A line that closes a frontmatter block. YAML allows `...` as a document end. */
function isClosingFence(line: string): boolean {
  const t = line.trimEnd();
  return t === '---' || t === '...';
}

/**
 * Returns null when the file does not open with a `---` fence — the caller
 * turns that into a `behavior/missing-frontmatter` error. A leading BOM and
 * leading blank lines are tolerated; anything else before the fence is not,
 * because a "frontmatter" that isn't at the top is almost always a typo.
 */
export function splitFrontmatter(raw: string): FrontmatterSplit | null {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text.split(/\r?\n/);

  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i >= lines.length || lines[i].trimEnd() !== '---') return null;

  const openIdx = i;
  for (let j = openIdx + 1; j < lines.length; j += 1) {
    if (isClosingFence(lines[j])) {
      return {
        yaml: lines.slice(openIdx + 1, j).join('\n'),
        // +1 to convert to 1-based, +1 more to step past the opening fence.
        yamlStartLine: openIdx + 2,
        body: lines.slice(j + 1).join('\n'),
      };
    }
  }
  // Opened but never closed — treat as absent rather than swallowing the whole
  // file as YAML, which would produce a baffling parse error far from the cause.
  return null;
}
