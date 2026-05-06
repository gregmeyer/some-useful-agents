/**
 * Pack install / uninstall orchestration.
 *
 * Operates on top of the three stores (PacksStore, DashboardsStore,
 * AgentStore) without coupling them to each other. Install creates
 * dashboards from the manifest and upserts any missing agents from
 * the embedded YAML; uninstall removes the dashboards but leaves the
 * agents intact (reference-only ownership model).
 */

import type { PacksStore } from './packs-store.js';
import type { DashboardsStore } from './dashboards-store.js';
import type { AgentStore } from './agent-store.js';
import { parseAgent } from './agent-yaml.js';

export interface PackInstallContext {
  packsStore: PacksStore;
  dashboardsStore: DashboardsStore;
  /**
   * Optional. When provided, install will upsert any agent listed in the
   * pack manifest's `agents:` block whose YAML is embedded and whose id
   * isn't already in AgentStore. Without it, install only creates
   * dashboards; missing agents will render as empty tiles until the user
   * installs them separately.
   */
  agentStore?: AgentStore;
}

export interface PackInstallResult {
  packId: string;
  dashboardsCreated: string[];
  agentsCreated: string[];
  agentsSkipped: string[];
}

/**
 * Install a registered pack. Idempotent — re-running on an installed
 * pack refreshes the dashboards from the current manifest.
 */
export function installPack(packId: string, ctx: PackInstallContext): PackInstallResult {
  const pack = ctx.packsStore.getPack(packId);
  if (!pack) throw new Error(`No pack registered with id "${packId}"`);
  const manifest = pack.manifest;

  const agentsCreated: string[] = [];
  const agentsSkipped: string[] = [];
  for (const ref of manifest.agents ?? []) {
    if (!ctx.agentStore) {
      // No store to install into — record the ref as skipped so the caller
      // sees what agents the pack expected to find.
      agentsSkipped.push(ref.id);
      continue;
    }
    if (ctx.agentStore.getAgent(ref.id)) {
      agentsSkipped.push(ref.id);
      continue;
    }
    if (!ref.yaml) {
      // Id-only refs (no embedded YAML) can't be auto-installed.
      agentsSkipped.push(ref.id);
      continue;
    }
    const agent = parseAgent(ref.yaml);
    if (agent.id !== ref.id) {
      throw new Error(`Pack "${packId}" agent ref id "${ref.id}" does not match YAML id "${agent.id}"`);
    }
    const { version: _v, ...agentNoVersion } = agent;
    void _v;
    ctx.agentStore.upsertAgent(agentNoVersion, 'import', `Installed via pack "${packId}"`);
    agentsCreated.push(ref.id);
  }

  const dashboardsCreated: string[] = [];
  for (const dash of manifest.dashboards ?? []) {
    const namespacedId = `${packId}:${dash.id}`;
    ctx.dashboardsStore.upsertDashboard({
      id: namespacedId,
      packId,
      name: dash.name,
      layout: { sections: dash.sections },
    });
    dashboardsCreated.push(namespacedId);
  }

  ctx.packsStore.markInstalled(packId);
  return { packId, dashboardsCreated, agentsCreated, agentsSkipped };
}

export interface PackUninstallResult {
  packId: string;
  dashboardsRemoved: number;
}

/**
 * Uninstall a pack. Removes its dashboards, marks the pack as
 * uninstalled, and leaves any agents the pack contributed alone
 * (reference-only ownership). Idempotent — re-running on an
 * uninstalled pack is a no-op.
 */
export function uninstallPack(packId: string, ctx: PackInstallContext): PackUninstallResult {
  const dashboardsRemoved = ctx.dashboardsStore.deleteByPack(packId);
  ctx.packsStore.markUninstalled(packId);
  return { packId, dashboardsRemoved };
}
