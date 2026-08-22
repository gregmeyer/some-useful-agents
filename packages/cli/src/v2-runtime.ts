/**
 * Shared v2 (DAG agent) runtime plumbing for the CLI.
 *
 * Extracted from `commands/workflow.ts` so that `sua agent run` and
 * `sua agent list` can reach v2 agents too. Before this existed, the
 * `agent` verbs went only through `loadAgents` — the V1 loader, which
 * SILENTLY SKIPS every v2 file — so `sua agent run <v2-id>` reported
 * "not found" for an agent that `sua workflow run` executed happily,
 * and the failure message pointed at `sua agent list`, a list that
 * could never contain what the user was looking for.
 *
 * `workflow` keeps its own verbs (import / export / replay / logs have
 * no `agent` equivalent); it just shares this module rather than owning
 * a second copy of the execution wiring. See ADR-0032.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import {
  AgentStore,
  RunStore,
  EncryptedFileStore,
  IntegrationsStore,
  VariablesStore,
  ToolStore,
  LlmSettingsStore,
  OutcomeStore,
  executeAgentWithRetry,
  outcomeDetectionHook,
  withOutcomeFeedback,
  type Agent,
  type Run,
} from '@some-useful-agents/core';
import chalk from 'chalk';
import {
  loadConfig,
  getDbPath,
  getSecretsPath,
  getDashboardBaseUrl,
  getLlmSettingsPath,
} from './config.js';
import * as ui from './ui.js';

export interface OpenedStores {
  db: DatabaseSync;
  agents: AgentStore;
  runs: RunStore;
  close: () => void;
}

/** Open the v2 agent + run stores against the configured DB path. */
export function openStores(): OpenedStores {
  const config = loadConfig();
  const dbPath = getDbPath(config);
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  const agents = AgentStore.fromHandle(db);
  const runs = RunStore.fromHandle(db);
  return {
    db,
    agents,
    runs,
    close: () => {
      agents.close();
      runs.close();
      db.close();
    },
  };
}

/**
 * Load the operator's LLM settings (waterfall + custom OpenAI-compatible
 * providers) as an executor snapshot. Without this, CLI runs can't resolve a
 * `kind:'openai'` custom provider (e.g. a local model) and silently fall through
 * to the default `claude` spawner. Best-effort: absent settings ⇒ undefined.
 */
export function loadLlmSettingsSnapshot(config: ReturnType<typeof loadConfig>) {
  try {
    const store = new LlmSettingsStore(getLlmSettingsPath(config));
    const current = store.get();
    const disabled = new Set(current.disabledProviders ?? []);
    return {
      providers: current.providers.filter((p) => !disabled.has(p)),
      disabledProviders: current.disabledProviders ? [...current.disabledProviders] : undefined,
      customProviders: current.customProviders ? [...current.customProviders] : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Look up a v2 agent by id without executing it. Used by `sua agent run`
 * to decide whether an unknown v1 name is actually a v2 agent, and by
 * `sua agent list` to merge both models into one table.
 *
 * Opens and closes its own store handle so callers that only need the
 * existence check don't leak a DB connection.
 */
export function findV2Agent(id: string): Agent | undefined {
  const stores = openStores();
  try {
    return stores.agents.getAgent(id) ?? undefined;
  } finally {
    stores.close();
  }
}

/** List every v2 agent in the store. Returns [] when the store is unreadable. */
export function listV2Agents(): Agent[] {
  let stores: OpenedStores | undefined;
  try {
    stores = openStores();
    return stores.agents.listAgents();
  } catch {
    return [];
  } finally {
    stores?.close();
  }
}

export interface RunV2Options {
  inputs: Record<string, string>;
  allowUntrustedShell: string[];
}

export interface RunV2Result {
  run: Run;
  /** True when an outcome record was written — only agents with an `outcome:` block produce one. */
  hasOutcomeRecord: boolean;
}

/**
 * Execute one v2 DAG agent synchronously. This is the single execution
 * path behind both `sua workflow run` and `sua agent run`; keeping it in
 * one place is the point of the module — the previous duplicate would
 * have drifted the moment either verb grew a store.
 *
 * Throws if the agent id is unknown, so callers own the "not found"
 * message (they differ: `agent run` suggests a v1-vs-v2 next step).
 */
export async function runV2Agent(id: string, options: RunV2Options): Promise<RunV2Result> {
  const config = loadConfig();
  const stores = openStores();
  const secretsStore = new EncryptedFileStore(getSecretsPath(config));
  // Optional stores — mirror the daemon's schedule wiring so CLI runs
  // can resolve csv/postgres/sqlite generated tools, vars, and user
  // tools the same way scheduled fires can. Each open is best-effort:
  // an absent store just means that feature doesn't resolve.
  const variablesStore = (() => {
    try { return new VariablesStore(join(config.dataDir, '.sua', 'variables.json')); }
    catch { return undefined; }
  })();
  const integrationsStore = (() => {
    try { return new IntegrationsStore(getDbPath(config)); }
    catch { return undefined; }
  })();
  const toolStore = (() => {
    try { return new ToolStore(getDbPath(config)); }
    catch { return undefined; }
  })();
  // OutcomeDetection: a no-op for agents with no `outcome:` block, so
  // this is safe to register unconditionally. Deterministic only — no
  // LLM judge on the CLI path, so a CLI run never silently spends
  // tokens. See docs/outcome-detection.md.
  const outcomeStore = (() => {
    try { return new OutcomeStore(getDbPath(config)); }
    catch { return undefined; }
  })();

  try {
    const agent = stores.agents.getAgent(id);
    if (!agent) throw new AgentNotFoundError(id);

    const run = await executeAgentWithRetry(
      agent,
      {
        triggeredBy: 'cli',
        // Cross-run feedback: hand this run what the PREVIOUS run of the same
        // agent failed to achieve. No-op unless the agent declares
        // OUTCOME_FEEDBACK in its `inputs:` block.
        inputs: withOutcomeFeedback(options.inputs, outcomeStore, id),
      },
      {
        runStore: stores.runs,
        secretsStore,
        agentStore: stores.agents,
        variablesStore,
        integrationsStore,
        toolStore,
        allowUntrustedShell: new Set(options.allowUntrustedShell),
        dashboardBaseUrl: getDashboardBaseUrl(config),
        dataRoot: stores.agents.dataRoot,
        llmSettings: loadLlmSettingsSnapshot(config),
        ...(outcomeStore && { onRunComplete: outcomeDetectionHook({ outcomeStore }) }),
      },
    );

    return { run, hasOutcomeRecord: Boolean(outcomeStore?.get(run.id)) };
  } finally {
    outcomeStore?.close();
    stores.close();
  }
}

/**
 * Print the result of a v2 run. Shared so `sua agent run` and
 * `sua workflow run` report identically — the only thing that differs
 * between the two verbs is the not-found message.
 */
export function reportV2Run(
  spinner: { succeed: (t: string) => void; fail: (t: string) => void },
  id: string,
  run: Run,
  hasOutcomeRecord: boolean,
): void {
  if (run.status === 'completed') {
    spinner.succeed(`${ui.agent(id)} completed`);
    if (run.result) {
      console.log('');
      ui.outputFrame(run.result);
    }
  } else {
    spinner.fail(`${ui.agent(id)} ${run.status}`);
    if (run.error) console.error(chalk.red(run.error));
  }
  console.log(ui.dim(`\nRun ID: ${run.id}`));
  console.log(ui.dim(`Inspect per-node logs: sua workflow logs ${run.id}`));
  // Only advertise the outcome record when one was actually written —
  // agents without an `outcome:` block produce none.
  if (hasOutcomeRecord) {
    console.log(ui.dim(`Inspect the outcome record: sua outcome show ${run.id.slice(0, 8)}`));
  }
}

/** Thrown by `runV2Agent` when the id is not in the store. */
export class AgentNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Agent "${id}" not found.`);
    this.name = 'AgentNotFoundError';
  }
}
