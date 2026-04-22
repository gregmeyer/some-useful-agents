import cron from 'node-cron';
import type { AgentDefinition, Provider, Run } from './types.js';
import { validateScheduleInterval } from './cron-validator.js';
import {
  writeHeartbeat,
  clearHeartbeat,
  acquirePidFile,
  releasePidFile,
} from './scheduler-heartbeat.js';
import { hasMissedFire, nextFireTime } from './scheduler-catchup.js';
import type { RunStore } from './run-store.js';

export interface ScheduledAgentEntry {
  agent: AgentDefinition;
  schedule: string;
}

export interface LocalSchedulerOptions {
  provider: Provider;
  agents: Map<string, AgentDefinition>;
  onFire?: (agent: AgentDefinition, runId: string) => void;
  onError?: (agent: AgentDefinition, error: Error) => void;
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
  private readonly provider: Provider;
  private readonly agents: Map<string, AgentDefinition>;
  private readonly onFire?: (agent: AgentDefinition, runId: string) => void;
  private readonly onError?: (agent: AgentDefinition, error: Error) => void;
  private readonly inputs: Record<string, string>;
  private readonly dataDir?: string;
  private readonly runStore?: RunStore;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  /** Track in-flight agents to prevent overlapping runs. */
  private readonly inFlight = new Set<string>();

  constructor(options: LocalSchedulerOptions) {
    this.provider = options.provider;
    this.agents = options.agents;
    this.onFire = options.onFire;
    this.onError = options.onError;
    this.inputs = options.inputs ?? {};
    this.dataDir = options.dataDir;
    this.runStore = options.runStore;
  }

  /**
   * Return entries with a `schedule` field, validated.
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

  /** Register cron tasks for every agent with a schedule. */
  async start(): Promise<ScheduledAgentEntry[]> {
    const entries = this.getScheduledAgents();

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

    // Missed-fire catch-up.
    if (this.runStore) {
      for (const { agent, schedule } of entries) {
        await this.catchUpIfMissed(agent, schedule);
      }
    }

    // Register cron tasks.
    for (const { agent, schedule } of entries) {
      const task = cron.schedule(schedule, async () => {
        await this.fireAgent(agent, schedule);
      });
      this.tasks.push({ agent, task });
    }

    // Start heartbeat.
    if (this.dataDir) {
      this.writeHeartbeatNow(entries);
      this.heartbeatTimer = setInterval(() => {
        this.writeHeartbeatNow(entries);
      }, HEARTBEAT_INTERVAL_MS);
      // Don't let the heartbeat timer prevent process exit.
      if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
    }

    return entries;
  }

  /** Stop all tasks and release resources. */
  stop(): void {
    for (const { task } of this.tasks) {
      task.stop();
    }
    this.tasks = [];

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
    // Concurrency guard: skip if this agent is already running.
    if (this.inFlight.has(agent.name)) {
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

    this.inFlight.add(agent.name);
    try {
      const run = await this.provider.submitRun({
        agent,
        triggeredBy: 'schedule',
        inputs: this.inputs,
      });
      this.onFire?.(agent, run.id);

      // Wait for the run to complete before clearing in-flight.
      // submitRun starts the agent but doesn't wait for completion.
      // We'll clear in-flight after a reasonable timeout so the guard
      // doesn't get stuck if the promise is never tracked.
      this.waitForRunCompletion(run, agent);
    } catch (err) {
      this.inFlight.delete(agent.name);
      this.onError?.(agent, err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Poll the run store for completion status. Clear the in-flight guard
   * when the run finishes or after a safety timeout.
   */
  private waitForRunCompletion(run: Run, agent: AgentDefinition): void {
    if (!this.runStore) {
      // No run store — clear after the agent's timeout + buffer.
      const timeoutMs = ((agent.timeout ?? 300) + 30) * 1000;
      setTimeout(() => this.inFlight.delete(agent.name), timeoutMs);
      return;
    }

    const store = this.runStore;
    const maxWaitMs = ((agent.timeout ?? 300) + 60) * 1000;
    const startTime = Date.now();
    const pollMs = 5_000;

    const poll = () => {
      if (Date.now() - startTime > maxWaitMs) {
        this.inFlight.delete(agent.name);
        return;
      }
      const current = store.getRun(run.id);
      if (current && (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled')) {
        this.inFlight.delete(agent.name);
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

  private writeHeartbeatNow(entries: ScheduledAgentEntry[]): void {
    if (!this.dataDir) return;

    const nextFires: Record<string, string> = {};
    for (const { agent, schedule } of entries) {
      const next = nextFireTime(schedule);
      if (next) nextFires[agent.name] = next;
    }

    writeHeartbeat(this.dataDir, {
      pid: process.pid,
      startedAt: this.startedAt,
      agents: entries.map((e) => e.agent.name),
      nextFires,
    });
  }

  private readonly startedAt = new Date().toISOString();
}
