/**
 * Template resolution for `{{upstream.<id>.result}}`, `{{upstream.<id>.<field>}}`,
 * and `{{vars.<NAME>}}` tokens in node prompts and env values.
 * Extracted from dag-executor.ts.
 */

/**
 * Substitute upstream templates in a text blob. Supports:
 *   - {{upstream.<id>.result}} — full raw output (original behavior)
 *   - {{upstream.<id>.<field>}} — dot-path extraction from JSON output
 *
 * When a field path (not "result") is used, the resolver tries to parse the
 * upstream output as JSON and extract the field. Falls back to empty string
 * if the output isn't JSON or the field doesn't exist.
 */
export function resolveUpstreamTemplate(text: string, snapshot: Record<string, string>): string {
  if (!text.includes('{{upstream.')) return text;

  // Match all {{upstream.nodeId.path}} references.
  const REF_RE = /\{\{upstream\.([a-z0-9][a-z0-9_-]*)\.([a-zA-Z0-9_.]+)\}\}/g;

  return text.replace(REF_RE, (_match, nodeId: string, fieldPath: string) => {
    const raw = snapshot[nodeId] ?? '';
    const safe = (v: string) => v.replace(/\{\{/g, '{ {');

    // {{upstream.X.result}} — return full output (backward compat).
    if (fieldPath === 'result') return safe(raw);

    // Try JSON dot-path extraction.
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const value = dotGet(parsed, fieldPath);
        if (value !== undefined) {
          return safe(typeof value === 'string' ? value : JSON.stringify(value));
        }
      }
    } catch { /* not JSON, fall through */ }

    // Fallback: return empty string (field not found).
    return '';
  });
}

/** Walk a dot-path into a nested object. */
function dotGet(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Substitute `{{vars.<NAME>}}` tokens from the global variables store.
 * Runs after upstream resolution but before input substitution.
 */
export function resolveVarsTemplate(text: string, vars: Record<string, string>): string {
  if (!text.includes('{{vars.')) return text;
  let out = text;
  for (const [name, value] of Object.entries(vars)) {
    const safe = value.replace(/\{\{/g, '{ {');
    out = out.split(`{{vars.${name}}}`).join(safe);
  }
  return out;
}

/**
 * Substitute `{{state}}` with the per-agent state-dir path. When stateDir
 * is undefined (executor running without dataRoot) the token resolves to
 * empty string — agents that reference `{{state}}` in those contexts
 * effectively become broken, but no template error fires; that's the
 * intended graceful degradation for tests + one-shot CLI runs.
 */
export function resolveStateTemplate(text: string, stateDir: string | undefined): string {
  if (!text.includes('{{state}}')) return text;
  return text.split('{{state}}').join(stateDir ?? '');
}
