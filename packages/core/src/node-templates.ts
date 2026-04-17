/**
 * Template resolution for `{{upstream.<id>.result}}` and `{{vars.<NAME>}}`
 * tokens in node prompts and env values. Extracted from dag-executor.ts.
 */

import { extractUpstreamReferences } from './agent-v2-schema.js';

/**
 * Substitute `{{upstream.<id>.result}}` tokens in a text blob. Deliberately
 * kept tiny and greedy — we rely on schema-time validation to guarantee
 * every reference resolves.
 */
export function resolveUpstreamTemplate(text: string, snapshot: Record<string, string>): string {
  if (!text.includes('{{upstream.')) return text;
  const refs = extractUpstreamReferences(text);
  let out = text;
  for (const id of refs) {
    const value = snapshot[id] ?? '';
    // Escape {{ in the substituted value so the inputs resolver that runs
    // afterwards can't re-expand it as a second template layer. Same
    // defense the v1 chain-resolver ships (chain-resolver.ts:120-125).
    const safe = value.replace(/\{\{/g, '{ {');
    // Use a simple literal replace; the ref format is fixed.
    out = out.split(`{{upstream.${id}.result}}`).join(safe);
  }
  return out;
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
