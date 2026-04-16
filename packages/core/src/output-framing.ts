/**
 * Output framing protocol. Shell tools emit structured output as a single
 * JSON line at the end of stdout. The executor scans bottom-up for the last
 * JSON-parseable line; that's the framed output. Everything before it stays
 * in `result` as the human-readable stdout.
 *
 * Design choice: bottom-up scan of the last non-empty line is simpler than
 * a sidecar FIFO or a magic delimiter. Tool authors use `jq` and `printf`
 * — tools they already know. See the plan (tools-and-outputs-v0.16.md,
 * "Output framing") for the full rationale.
 */

import type { ToolOutput } from './tool-types.js';

/**
 * Attempt to extract a framed JSON output from stdout. Returns the parsed
 * object if the last non-empty line is valid JSON, or `undefined` if not.
 *
 * When framed output is found:
 * - `output` = the parsed JSON object (tool's declared outputs)
 * - `result` = the full stdout (for v0.15 compat / debugging)
 *
 * When no framed output is found, the caller should treat `result` = full
 * stdout as the only output (v0.15 behaviour).
 */
export function extractFramedOutput(stdout: string): ToolOutput | undefined {
  const lines = stdout.split('\n');
  // Walk bottom-up past empty lines and trailing whitespace.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    // Quick guard: JSON objects start with { or [; skip obvious non-JSON.
    if (line[0] !== '{' && line[0] !== '[') return undefined;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as ToolOutput;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  return undefined;
}

/**
 * Build a ToolOutput from a raw execution result. Tries framed output
 * first; falls back to wrapping the result string. Always sets `result`
 * for v0.15 compat.
 */
export function buildToolOutput(stdout: string): ToolOutput {
  const framed = extractFramedOutput(stdout);
  if (framed) {
    return { ...framed, result: stdout };
  }
  return { result: stdout };
}
