import type { Agent, VariablesStore } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

export interface PaletteSuggestions {
  /** Upstream node ids available to this node. */
  upstreams: string[];
  /** Agent-level declared input names. */
  inputs: string[];
  /** Secret names this node declares (per-node injection). */
  secrets: string[];
  /** Global variable names from /settings/variables. */
  vars: string[];
}

/**
 * Compute the set of template + env-var suggestions surfaced by the
 * command-palette on node edit/add forms. Sources:
 *   - `upstreams`: all other nodes in the agent. The author may pick
 *     a subset via `dependsOn:` — the palette offers the full list so
 *     users don't have to toggle checkboxes before typing. Save-time
 *     Zod re-validation catches references to undeclared upstreams.
 *   - `inputs`: `agent.inputs` names (agent-level runtime inputs).
 *   - `secrets`: the declared secrets on the node under edit (or
 *     empty for new nodes — the add-node form doesn't yet edit
 *     `secrets:`). Secrets are per-node, not agent-level, so this
 *     list is empty on add-node today; edit-node uses the current
 *     node's declared list.
 */
export function computePaletteSuggestions(
  agent: Agent,
  opts: { excludeNodeId?: string; nodeSecrets?: string[]; variablesStore?: VariablesStore } = {},
): PaletteSuggestions {
  const upstreams = agent.nodes
    .map((n) => n.id)
    .filter((id) => id !== opts.excludeNodeId)
    .sort();
  const inputs = Object.keys(agent.inputs ?? {}).sort();
  const secrets = (opts.nodeSecrets ?? []).slice().sort();
  const vars = opts.variablesStore ? opts.variablesStore.listNames() : [];
  return { upstreams, inputs, secrets, vars };
}

/**
 * Render the palette's data blob as a `<script type="application/json">`
 * tag. Content is read by the client palette on input events; keeping
 * it in a JSON payload avoids hand-rolled HTML attribute escaping on
 * per-field data blobs.
 */
export function renderPalettePayload(
  id: string,
  suggestions: PaletteSuggestions,
): SafeHtml {
  // Ids in our schema are lowercase-alphanumeric-hyphens; escape the
  // </script end-tag sequence to keep the payload inert.
  const json = JSON.stringify(suggestions).replace(/<\/script/gi, '<\\/script');
  return html`<script id="${id}" type="application/json">${unsafeHtml(json)}</script>`;
}
