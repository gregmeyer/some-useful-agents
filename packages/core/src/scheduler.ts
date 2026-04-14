import cron from 'node-cron';
import type { AgentDefinition, Provider } from './types.js';
import { validateScheduleInterval } from './cron-validator.js';

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
}

export class LocalScheduler {
  private tasks: Array<{ agent: AgentDefinition; task: cron.ScheduledTask }> = [];
  private readonly provider: Provider;
  private readonly agents: Map<string, AgentDefinition>;
  private readonly onFire?: (agent: AgentDefinition, runId: string) => void;
  private readonly onError?: (agent: AgentDefinition, error: Error) => void;
  private readonly inputs: Record<string, string>;

  constructor(options: LocalSchedulerOptions) {
    this.provider = options.provider;
    this.agents = options.agents;
    this.onFire = options.onFire;
    this.onError = options.onError;
    this.inputs = options.inputs ?? {};
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
  start(): ScheduledAgentEntry[] {
    const entries = this.getScheduledAgents();
    for (const { agent, schedule } of entries) {
      const task = cron.schedule(schedule, async () => {
        if (agent.allowHighFrequency) {
          // Loud warning so operators see the unbounded cost surface.
          console.warn(
            `[high-frequency] agent "${agent.name}" firing on schedule "${schedule}". ` +
              `allowHighFrequency=true bypasses the safety cap.`,
          );
        }
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
      });
      this.tasks.push({ agent, task });
    }
    return entries;
  }

  /** Stop all tasks and release resources. */
  stop(): void {
    for (const { task } of this.tasks) {
      task.stop();
    }
    this.tasks = [];
  }

  /** True if a cron expression parses cleanly. Does NOT enforce the frequency cap. */
  static isValid(expression: string): boolean {
    return cron.validate(expression);
  }
}
