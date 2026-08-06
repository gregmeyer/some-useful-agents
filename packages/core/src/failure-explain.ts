/**
 * Human-readable explanations for node/run failures.
 *
 * A failed node carries two machine artifacts: the `errorCategory` enum
 * (`exit_nonzero`, `timeout`, …) and, for shell nodes, an exit code + stderr.
 * On their own these read as jargon — `exit_nonzero` tells an operator nothing
 * actionable. This module is the single source of truth that turns them into one
 * plain sentence like:
 *
 *   Node "fetch" exited with code 127 (command not found): fetch.sh: curl: not found
 *
 * Lives in core (not the dashboard) so the CLI, dashboard, and inbox all render
 * the SAME wording. The dashboard re-exports these from `views/components.ts`.
 * The `errorCategory` field itself is never rewritten — it drives retry-policy
 * filters and dashboard badges; only the human prose is derived here.
 */

/** Common exit codes → what they usually mean, for shell nodes. */
export const EXIT_CODE_LABELS: Record<number, string> = {
  0: 'success',
  1: 'general error',
  2: 'misuse of shell command',
  3: 'cannot execute (curl: URL malformed)',
  6: 'curl: could not resolve host',
  7: 'curl: failed to connect',
  22: 'curl: HTTP error (4xx/5xx)',
  28: 'curl: timeout',
  126: 'permission denied',
  127: 'command not found',
  128: 'invalid exit argument',
  130: 'terminated by Ctrl+C (SIGINT)',
  137: 'killed (SIGKILL / out of memory)',
  139: 'segmentation fault (SIGSEGV)',
  143: 'terminated (SIGTERM)',
};

/**
 * The meaning of an exit code (label only, no `exit N` prefix). Expands the
 * 129-165 signal range to `signal N` when not otherwise labelled. Returns
 * undefined for a bare/unknown code so callers can omit the parenthetical.
 */
function exitCodeMeaning(code: number): string | undefined {
  const label = EXIT_CODE_LABELS[code];
  if (label) return label;
  if (code >= 129 && code <= 165) return `signal ${code - 128}`;
  return undefined;
}

/** Render a run/node exit code as `exit 127 (command not found)`. */
export function formatExitCode(code: number | null | undefined): string {
  // DAG/multi-node runs (and some legacy v1 runs) have no run-level exit code —
  // the store returns null, which must render as "no exit code", not "exit null".
  if (code == null) return '';
  const meaning = exitCodeMeaning(code);
  return meaning ? `exit ${code} (${meaning})` : `exit ${code}`;
}

/**
 * Prose label for a failure category. Covers every `NodeErrorCategory`; falls
 * back to the raw code for anything unknown (e.g. an LlmFailureCategory that
 * only shows in provider-failure hover text).
 */
const ERROR_CATEGORY_LABELS: Record<string, string> = {
  setup: 'Setup failed (before execution)',
  input_resolution: 'Template substitution failed',
  spawn_failure: 'Process could not start',
  exit_nonzero: 'Non-zero exit code',
  timeout: 'Timed out',
  cancelled: 'Cancelled',
  abandoned: 'Abandoned (dashboard restarted mid-run)',
  upstream_failed: 'Skipped (upstream failed)',
  condition_not_met: 'Skipped (condition not met)',
  flow_ended: 'Flow ended',
  invalid_output: 'Output failed the task contract',
  policy_denied: 'Blocked by tool policy',
};

export { ERROR_CATEGORY_LABELS };

export function formatErrorCategory(category: string): string {
  return ERROR_CATEGORY_LABELS[category] ?? category;
}

export interface NodeFailure {
  /** The failing node's id. Omitted at run level → the `Node "x"` prefix is dropped. */
  nodeId?: string;
  /** NodeErrorCategory, e.g. `exit_nonzero`. */
  category?: string;
  /** Process exit code (shell nodes). */
  exitCode?: number | null;
  /** stderr / error text — may be multi-line; its last line is the usual cause. */
  error?: string;
  /** The node's shell command, when known. Reserved for future context. */
  command?: string;
}

/** Max length of the appended stderr snippet. */
const STDERR_TAIL_CAP = 160;

/**
 * The last non-empty line of the error text — the line that usually names the
 * actual cause (`curl: command not found`). Skips the synthetic
 * `Process exited with code N` fallback (it just restates the exit code) and
 * truncates to keep the one-liner readable.
 */
function stderrTail(error?: string): string | undefined {
  if (!error) return undefined;
  const lines = error.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;
  let last = lines[lines.length - 1];
  if (/^Process exited with code/i.test(last)) return undefined;
  if (last.length > STDERR_TAIL_CAP) last = `${last.slice(0, STDERR_TAIL_CAP - 1).trimEnd()}…`;
  return last;
}

/**
 * One-line, human-readable explanation of a node failure. No trailing
 * punctuation. Combines the category, the exit code and its meaning, and the
 * stderr tail into a single actionable sentence.
 */
export function explainNodeFailure(f: NodeFailure): string {
  const prefix = f.nodeId ? `Node "${f.nodeId}" ` : '';
  const tail = stderrTail(f.error);
  const withTail = (s: string): string => (tail ? `${s}: ${tail}` : s);

  switch (f.category) {
    case 'exit_nonzero': {
      if (f.exitCode != null) {
        const meaning = exitCodeMeaning(f.exitCode);
        const base = `${prefix}exited with code ${f.exitCode}${meaning ? ` (${meaning})` : ''}`;
        return withTail(base);
      }
      return withTail(`${prefix}exited with a non-zero code`);
    }
    case 'timeout':
      return withTail(`${prefix}timed out`);
    case 'spawn_failure':
      return withTail(`${prefix}could not start (missing binary or command not found)`);
    default: {
      // setup / input_resolution / upstream_failed / condition_not_met /
      // flow_ended / invalid_output / abandoned / policy_denied / cancelled,
      // plus any unknown code (falls back to the raw category via the map).
      const label = f.category ? formatErrorCategory(f.category) : 'Failed';
      const base = prefix ? `${prefix.trimEnd()}: ${label}` : label;
      return withTail(base);
    }
  }
}
