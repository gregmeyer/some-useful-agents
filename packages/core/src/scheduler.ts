import cron from 'node-cron';
import type { AgentDefinition, Provider, Run } from './types.js';
import type { Agent } from './agent-v2-types.js';
import { validateScheduleInterval } from './cron-validator.js';
import {
  writeHeartbeat,
  clearHeartbeat,
  acquirePidFile,
  releasePidFile,
} from './scheduler-heartbeat.js';
import { hasMissedFire, nextFireTime } from './scheduler-catchup.js';
import type { RunStore } from './run-store.js';
import type { SecretsStore } from './secrets-store.js';
import type { VariablesStore } from './variables-store.js';
import type { IntegrationsStore } from './integrations-store.js';
import type { AgentStore } from './agent-store.js';
import type { ToolStore } from './tool-store.js';
import { executeAgentLoop } from './agent-loop/runner.js';
import type { AgentMemoryStore } from './agent-loop/memory-store.js';

export interface ScheduledAgentEntry {
  agent: AgentDefinition;
  schedule: string;
}

export interface ScheduledV2AgentEntry {
  agent: Agent;
  schedule: string;
}

/**
 * Dependencies the scheduler needs to fire v2 (DAG) agents directly via
 * `executeAgentWithRetry`. v1 agents continue to flow through the
 * `Provider.submitRun` interface; v2 has no provider abstraction yet
 * (see the dangling "PR 4b" comment in workflow.ts), so we wire the
 * executor's deps in directly.
 */
export interface V2SchedulerDeps {
  runStore: RunStore;
  secretsStore?: SecretsStore;
  variablesStore?: VariablesStore;
  integrationsStore?: IntegrationsStore;
  agentStore?: AgentStore;
  toolStore?: ToolStore;
  allowUntrustedShell?: ReadonlySet<string>;
  dashboardBaseUrl?: string;
  /** Same semantics as DagExecutorDeps.dataRoot. */
  dataRoot?: string;
  /**
   * Agent-loop memory store (PR 4 of the planner refactor). Threaded
   * through so per-iteration observations + eval status get persisted
   * when an agent declares `successCriteria`. Optional — without it the
   * agent loop still runs, just silently.
   */
  agentMemoryStore?: AgentMemoryStore;
}

export interface LocalSchedulerOptions {
  provider: Provider;
  agents: Map<string, AgentDefinition>;
  /**
   * v2 (DAG) agents to schedule alongside the v1 agents above. Wired
   * separately because v2 has its own executor and dep bundle. Empty by
   * default — callers that only deal in v1 don't need to think about it.
   */
  v2Agents?: Agent[];
  /**
   * Required iff `v2Agents` is non-empty. Provides the executor wiring
   * (run store, secrets, variables, etc.) that `executeAgentWithRetry`
   * needs to run a DAG agent.
   */
  v2Deps?: V2SchedulerDeps;
  onFire?: (agent: AgentDefinition | Agent, runId: string) => void;
  onError?: (agent: AgentDefinition | Agent, error: Error) => void;
  /**
   * Daemon-wide input overrides supplied via `sua schedule start --input K=V`.
   * Applied to every run the scheduler fires; individual agents that don't
   * declare a given input simply ignore it (via `resolveInputs`).
   */
  inputs?: Record<string, string>;
  /** Data directory for heartbeat + PID files. Enables resilience features when set. */
  dataDir?: string;
  /** Run store for missed-fire catch-up queries. */
  runStore?: RunStore;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

export class LocalScheduler {
  private tasks: Array<{ agent: AgentDefinition; task: cron.ScheduledTask }> = [];
  private v2Tasks: Array<{ agent: Agent; task: cron.ScheduledTask }> = [];
  private readonly provider: Provider;
  private readonly agents: Map<string, AgentDefinition>;
  private readonly v2Agents: Agent[];
  private readonly v2Deps?: V2SchedulerDeps;
  private readonly onFire?: (agent: AgentDefinition | Agent, runId: string) => void;
  private readonly onError?: (agent: AgentDefinition | Agent, error: Error) => void;
  private readonly inputs: Record<string, string>;
  private readonly dataDir?: string;
  private readonly runStore?: RunStore;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  /**
   * Track in-flight agents to prevent overlapping runs. Keyed by a stable
   * identity ("v1:<name>" or "v2:<id>") so v1 and v2 agents that happen to
   * share a name don't shadow each other.
   */
  private readonly inFlight = new Set<string>();

  constructor(options: LocalSchedulerOptions) {
    this.provider = options.provider;
    this.agents = options.agents;
    this.v2Agents = options.v2Agents ?? [];
    this.v2Deps = options.v2Deps;
    this.onFire = options.onFire;
    this.onError = options.onError;
    this.inputs = options.inputs ?? {};
    this.dataDir = options.dataDir;
    this.runStore = options.runStore;

    if (this.v2Agents.length > 0 && !this.v2Deps) {
      throw new Error(
        'LocalScheduler: v2Agents supplied without v2Deps. ' +
        'Pass { runStore, secretsStore, variablesStore, ... } via v2Deps.',
      );
    }
  }

  /**
   * Return v1 entries with a `schedule` field, validated.
   * Throws on invalid cron strings or schedules that exceed the frequency cap.
   */
  getScheduledAgents(): ScheduledAgentEntry[] {
    const entries: ScheduledAgentEntry[] = [];
    for (const agent of this.agents.values()) {
      if (!agent.schedule) continue;
      try {
        validateScheduleInterval(agent.schedule, { allowHighFrequency: agent.allowHighFrequency });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Agent "${agent.name}": ${message}`);
      }
      entries.push({ agent, schedule: agent.schedule });
    }
    return entries;
  }

  /**
   * Return v2 entries with a `schedule` field, validated. Same cap-checking
   * rules as v1 — `allowHighFrequency` opts out per-agent.
   */
  getScheduledV2Agents(): ScheduledV2AgentEntry[] {
    const entries: ScheduledV2AgentEntry[] = [];
    for (const agent of this.v2Agents) {
      if (!agent.schedule) continue;
      if (agent.status !== 'active') continue;
      try {
        validateScheduleInterval(agent.schedule, { allowHighFrequency: agent.allowHighFrequency });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Agent "${agent.id}": ${message}`);
      }
      entries.push({ agent, schedule: agent.schedule });
    }
    return entries;
  }

  /** Register cron tasks for every agent with a schedule. */
  async start(): Promise<ScheduledAgentEntry[]> {
    const entries = this.getScheduledAgents();
    const v2Entries = this.getScheduledV2Agents();

    // PID file guard.
    if (this.dataDir) {
      const { acquired, existingPid } = acquirePidFile(this.dataDir);
      if (!acquired) {
        throw new Error(
          `Scheduler already running (PID ${existingPid}). ` +
          `Use 'sua schedule stop' or kill the process.`,
        );
      }
    }

    // Missed-fire catch-up (v1).
    if (this.runStore) {
      for (const { agent, schedule } of entries) {
        await this.catchUpIfMissed(agent, schedule);
      }
      // Missed-fire catch-up (v2). Looks up by agent.id since that's the
      // run-store agentName field for DAG runs (see dag-executor.ts:198).
      for (const { agent, schedule } of v2Entries) {
        await this.catchUpV2IfMissed(agent, schedule);
      }
    }

    // Register cron tasks (v1).
    for (const { agent, schedule } of entries) {
      const task = cron.schedule(schedule, async () => {
        await this.fireAgent(agent, schedule);
      });
      this.tasks.push({ agent, task });
    }

    // Register cron tasks (v2).
    for (const { agent, schedule } of v2Entries) {
      const task = cron.schedule(schedule, async () => {
        await this.fireV2Agent(agent, schedule);
      });
      this.v2Tasks.push({ agent, task });
    }

    // Start heartbeat. Includes both v1 and v2 agents in the registered
    // list so the dashboard's idle-detection sees the full picture.
    if (this.dataDir) {
      this.writeHeartbeatNow(entries, v2Entries);
      this.heartbeatTimer = setInterval(() => {
        this.writeHeartbeatNow(entries, v2Entries);
      }, HEARTBEAT_INTERVAL_MS);
      // Don't let the heartbeat timer prevent process exit.
      if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
    }

    return entries;
  }

  /** Stop all tasks and release resources. */
  stop(): void {
    for (const { task } of this.tasks) task.stop();
    for (const { task } of this.v2Tasks) task.stop();
    this.tasks = [];
    this.v2Tasks = [];

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.dataDir) {
      clearHeartbeat(this.dataDir);
      releasePidFile(this.dataDir);
    }
  }

  /** True if a cron expression parses cleanly. Does NOT enforce the frequency cap. */
  static isValid(expression: string): boolean {
    return cron.validate(expression);
  }

  // ── Private ─────────────────────────────────────────────────────────

  private async fireAgent(agent: AgentDefinition, schedule: string): Promise<void> {
    const key = `v1:${agent.name}`;
    if (this.inFlight.has(key)) {
      console.warn(
        `[overlap] "${agent.name}" still running from previous fire; skipping this tick`,
      );
      return;
    }

    if (agent.allowHighFrequency) {
      console.warn(
        `[high-frequency] agent "${agent.name}" firing on schedule "${schedule}". ` +
          `allowHighFrequency=true bypasses the safety cap.`,
      );
    }

    this.inFlight.add(key);
    try {
      const run = await this.provider.submitRun({
        agent,
        triggeredBy: 'schedule',
        inputs: this.inputs,
      });
      this.onFire?.(agent, run.id);
      this.waitForRunCompletion(run, key, agent.timeout);
    } catch (err) {
      this.inFlight.delete(key);
      this.onError?.(agent, err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Fire a v2 (DAG) agent. Bypasses the v1 Provider.submitRun pathway
   * because v2 has no provider abstraction yet — we call the executor
   * directly (same path the dashboard's /run-now and the CLI's
   * `sua workflow run` already use).
   */
  private async fireV2Agent(agent: Agent, schedule: string): Promise<void> {
    if (!this.v2Deps) return; // start() guarantees this, but type-narrows here.

    const key = `v2:${agent.id}`;
    if (this.inFlight.has(key)) {
      console.warn(
        `[overlap] v2 "${agent.id}" still running from previous fire; skipping this tick`,
      );
      return;
    }

    if (agent.allowHighFrequency) {
      console.warn(
        `[high-frequency] v2 agent "${agent.id}" firing on schedule "${schedule}". ` +
          `allowHighFrequency=true bypasses the safety cap.`,
      );
    }

    this.inFlight.add(key);
    // executeAgentLoop wraps executeAgentWithRetry with the agent-loop
    // eval gate (PR 4 of the planner refactor). When the agent declares
    // no `successCriteria` it's a pure pass-through — byte-equivalent to
    // the prior executeAgentWithRetry call. When criteria are declared,
    // each iteration's pass/fail + observations land in agent_memory.
    executeAgentLoop(
      agent,
      { triggeredBy: 'schedule', inputs: this.inputs },
      {
        runStore: this.v2Deps.runStore,
        secretsStore: this.v2Deps.secretsStore,
        variablesStore: this.v2Deps.variablesStore,
        integrationsStore: this.v2Deps.integrationsStore,
        agentStore: this.v2Deps.agentStore,
        toolStore: this.v2Deps.toolStore,
        allowUntrustedShell: this.v2Deps.allowUntrustedShell,
        dashboardBaseUrl: this.v2Deps.dashboardBaseUrl,
        dataRoot: this.v2Deps.dataRoot,
      },
      { memoryStore: this.v2Deps.agentMemoryStore },
    ).then(
      (run) => {
        this.onFire?.(agent, run.id);
        this.inFlight.delete(key);
      },
      (err) => {
        this.inFlight.delete(key);
        this.onError?.(agent, err instanceof Error ? err : new Error(String(err)));
      },
    );
  }

  /**
   * Poll the run store for completion status. Clear the in-flight guard
   * when the run finishes or after a safety timeout. The `inFlightKey`
   * is the namespaced identity used in `this.inFlight` ("v1:<name>").
   */
  private waitForRunCompletion(run: Run, inFlightKey: string, agentTimeout?: number): void {
    if (!this.runStore) {
      const timeoutMs = ((agentTimeout ?? 300) + 30) * 1000;
      setTimeout(() => this.inFlight.delete(inFlightKey), timeoutMs);
      return;
    }

    const store = this.runStore;
    const maxWaitMs = ((agentTimeout ?? 300) + 60) * 1000;
    const startTime = Date.now();
    const pollMs = 5_000;

    const poll = () => {
      if (Date.now() - startTime > maxWaitMs) {
        this.inFlight.delete(inFlightKey);
        return;
      }
      const current = store.getRun(run.id);
      if (current && (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled')) {
        this.inFlight.delete(inFlightKey);
        return;
      }
      setTimeout(poll, pollMs);
    };

    setTimeout(poll, pollMs);
  }

  private async catchUpIfMissed(agent: AgentDefinition, schedule: string): Promise<void> {
    if (!this.runStore) return;

    // Find the last scheduled run for this agent.
    const result = this.runStore.queryRuns({
      agentName: agent.name,
      triggeredBy: 'schedule',
      limit: 1,
    });

    const lastRun = result.rows[0];
    const lastFireTime = lastRun?.completedAt ?? lastRun?.startedAt;

    if (hasMissedFire(schedule, lastFireTime)) {
      console.log(
        `[catch-up] "${agent.name}" missed a scheduled fire ` +
        `(last: ${lastFireTime ?? 'never'}). Firing now.`,
      );
      try {
        const run = await this.provider.submitRun({
          agent,
          triggeredBy: 'schedule',
          inputs: this.inputs,
        });
        this.onFire?.(agent, run.id);
      } catch (err) {
        this.onError?.(agent, err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  /**
   * v2 catch-up. Same shape as the v1 path, but the run-store agentName
   * for v2 runs is the agent.id (set by dag-executor.ts when creating the
   * row), and the fire path goes through executeAgentWithRetry rather
   * than the v1 provider.
   */
  private async catchUpV2IfMissed(agent: Agent, schedule: string): Promise<void> {
    if (!this.runStore || !this.v2Deps) return;

    const result = this.runStore.queryRuns({
      agentName: agent.id,
      triggeredBy: 'schedule',
      limit: 1,
    });
    const lastRun = result.rows[0];
    const lastFireTime = lastRun?.completedAt ?? lastRun?.startedAt;

    if (hasMissedFire(schedule, lastFireTime)) {
      console.log(
        `[catch-up] v2 "${agent.id}" missed a scheduled fire ` +
        `(last: ${lastFireTime ?? 'never'}). Firing now.`,
      );
      // fireV2Agent handles in-flight tracking + onFire/onError dispatch.
      await this.fireV2Agent(agent, schedule);
    }
  }

  private writeHeartbeatNow(
    entries: ScheduledAgentEntry[],
    v2Entries: ScheduledV2AgentEntry[] = [],
  ): void {
    if (!this.dataDir) return;

    const nextFires: Record<string, string> = {};
    for (const { agent, schedule } of entries) {
      const next = nextFireTime(schedule);
      if (next) nextFires[agent.name] = next;
    }
    for (const { agent, schedule } of v2Entries) {
      const next = nextFireTime(schedule);
      // Keyed by id — matches the dashboard widget's lookup at
      // `lastFires[a.id]` and `heartbeat.nextFires[a.id]`.
      if (next) nextFires[agent.id] = next;
    }

    writeHeartbeat(this.dataDir, {
      pid: process.pid,
      startedAt: this.startedAt,
      agents: [
        ...entries.map((e) => e.agent.name),
        ...v2Entries.map((e) => e.agent.id),
      ],
      nextFires,
    });
  }

  private readonly startedAt = new Date().toISOString();
}
