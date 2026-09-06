/**
 * Triage prompt composition — loads the shared "kernel" and the one per-source
 * "playbook" that the inbox-triage agent's prompt is assembled from at run time.
 *
 * The triage prompt used to be a single ~550-line block in
 * `agents/examples/inbox-triage.yaml`. That mixed shared mechanics (voice,
 * action-proposal rules, the `<plan>` output schema) with source-specific
 * "what to recommend" guidance, so every concern interfered with every other.
 * Now the YAML carries just the dynamic context block and references
 * `{{inputs.SOURCE_PLAYBOOK}}` + `{{inputs.TRIAGE_KERNEL}}`, which the route
 * injects from disk:
 *   - kernel.md          — shared mechanics, one source of truth (coupled to the
 *                          route's <plan> parser).
 *   - playbooks/<src>.md — only the guidance for THIS thread's source.
 *
 * Fragments are read fresh per call (small files, negligible next to the LLM
 * call) so editing them lands without a restart, mirroring how the agent YAML
 * itself auto-refreshes via ensureSystemAgentCurrent. On any read error the
 * loader returns '' so triage still runs (degraded, not broken).
 */
import { readFileSync } from 'node:fs';
import { resolveExamplePath } from '@some-useful-agents/core';

/**
 * Fragment paths inside the examples tree. `resolveExamplePath` tries the
 * repo copy first and the bundled package copy second, so triage keeps its
 * prompt on an npm install where `agents/examples/` does not exist.
 */
const TRIAGE_PROMPT_DIR = 'inbox-triage';

/** Message sources that have a dedicated playbook. Anything else → manual. */
const PLAYBOOK_SOURCES = new Set(['run-failure', 'permission-request', 'cadence', 'manual']);

/** Strip a leading HTML comment (editor note) so it never reaches the model. */
function stripLeadingComment(text: string): string {
  return text.replace(/^\s*<!--[\s\S]*?-->\s*/, '');
}

/** The shared triage kernel (voice, action mechanics, `<plan>` schema). */
export function loadTriageKernel(): string {
  try {
    const path = resolveExamplePath(`${TRIAGE_PROMPT_DIR}/kernel.md`);
    if (path === null) return '';
    return stripLeadingComment(readFileSync(path, 'utf-8')).trim();
  } catch {
    return '';
  }
}

/**
 * The per-source playbook for a thread. Unknown/empty sources fall back to the
 * `manual` playbook (free-form operator intent) rather than no guidance.
 */
export function loadTriagePlaybook(source: string | undefined): string {
  const key = source && PLAYBOOK_SOURCES.has(source) ? source : 'manual';
  try {
    const path = resolveExamplePath(`${TRIAGE_PROMPT_DIR}/playbooks/${key}.md`);
    if (path === null) return '';
    return readFileSync(path, 'utf-8').trim();
  } catch {
    return '';
  }
}
