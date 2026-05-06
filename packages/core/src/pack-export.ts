/**
 * Export a stored Dashboard as a Pack manifest YAML.
 *
 * Companion to pack-loader (which reads built-in pack manifests). The
 * export path is the user-facing way to bundle "the dashboard I just
 * curated, plus the agents it references" into a single, shareable
 * artifact. Round-trips through the loader: the YAML this function
 * emits is parseable by `packManifestSchema` + installable via
 * `installPack`.
 *
 * Reference-only ownership stays consistent — exporting doesn't change
 * the live agents/dashboard at all; it just snapshots them.
 */

import { stringify as stringifyYaml } from 'yaml';
import { exportAgent } from './agent-yaml.js';
import type { Agent } from './agent-v2-types.js';
import type { Dashboard } from './dashboards-store.js';
import type { PackManifest } from './packs-store.js';

export interface DashboardExportInput {
  dashboard: Dashboard;
  /** Resolved agents referenced by the dashboard's sections. Missing agents are skipped. */
  agents: Agent[];
  /** Optional pack-id override. Default derives from dashboard.id by stripping the `user:` prefix. */
  packId?: string;
  /** Optional pack-name override. Default = dashboard.name. */
  packName?: string;
  /** Optional version. Default 0.1.0 — exporters should bump on edits. */
  version?: string;
  author?: string;
  description?: string;
}

export interface DashboardExportResult {
  manifest: PackManifest;
  /** YAML rendering of the manifest, ready to write/download. */
  yaml: string;
  /** Agent ids the dashboard referenced but the caller didn't supply. */
  missingAgentIds: string[];
}

/**
 * Build a PackManifest from a dashboard and its referenced agents.
 * Inlines each agent's full YAML under `agents[]`. The packed
 * dashboard id strips the `user:` / `<pack>:` prefix so the resulting
 * manifest is portable.
 */
export function dashboardToPackManifest(input: DashboardExportInput): DashboardExportResult {
  const { dashboard, agents } = input;
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Collect every agent id referenced anywhere in the dashboard sections.
  const referencedIds = new Set<string>();
  for (const section of dashboard.layout.sections) {
    for (const id of section.agentIds) referencedIds.add(id);
  }

  const missingAgentIds: string[] = [];
  const packedAgents = [];
  for (const id of referencedIds) {
    const agent = agentMap.get(id);
    if (!agent) {
      missingAgentIds.push(id);
      continue;
    }
    packedAgents.push({
      id: agent.id,
      yaml: exportAgent(agent),
    });
  }

  const packId = input.packId ?? slugifyDashboardId(dashboard.id);
  const packName = input.packName ?? dashboard.name;
  const innerDashboardId = bareDashboardId(dashboard.id);

  const manifest: PackManifest = {
    id: packId,
    name: packName,
    description: input.description ?? `Exported from dashboard "${dashboard.name}".`,
    version: input.version ?? '0.1.0',
    author: input.author,
    agents: packedAgents,
    dashboards: [{
      id: innerDashboardId,
      name: dashboard.name,
      sections: dashboard.layout.sections,
    }],
  };

  return {
    manifest,
    yaml: stringifyYaml(manifest, { lineWidth: 0 }),
    missingAgentIds,
  };
}

/**
 * Drop the namespace prefix on a stored dashboard id when packing.
 * Stored ids look like `user:morning-briefing` or `starter:media`;
 * the manifest's inner dashboard id only needs the bare slug.
 */
function bareDashboardId(id: string): string {
  const colon = id.indexOf(':');
  return colon >= 0 ? id.slice(colon + 1) : id;
}

/**
 * Build a pack-id from a dashboard id. Strips the namespace prefix
 * and lowercases. Pack ids must match `^[a-z0-9][a-z0-9-]*$` per the
 * pack manifest schema.
 */
function slugifyDashboardId(id: string): string {
  const bare = bareDashboardId(id).toLowerCase();
  return bare.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
}
