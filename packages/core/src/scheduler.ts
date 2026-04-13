import cron from 'node-cron';
import type { AgentDefinition, Provider } from './types.js';

export interface ScheduledAgentEntry {
  agent: AgentDefinition;
  schedule: string;
}

export interface LocalSchedulerOptions {
  provider: Provider;
  agents: Map<string, AgentDefinition>;
  onFire?: (agent: AgentDefinition, runId: string) => void;
  onError?: (agent: AgentDefinition, error: Error) => void;
}

export class LocalScheduler {
  private tasks: Array<{ agent: AgentDefinition; task: cron.ScheduledTask }> = [];
  private readonly provider: Provider;
  private readonly agents: Map<string, AgentDefinition>;
  private readonly onFire?: (agent: AgentDefinition, runId: string) => void;
  private readonly onError?: (agent: AgentDefinition, error: Error) => void;

  constructor(options: LocalSchedulerOptions) {
    this.provider = options.provider;
    this.agents = options.agents;
    this.onFire = options.onFire;
    this.onError = options.onError;
  }

  /** Return entries with a `schedule` field, validated. Throws on invalid cron strings. */
  getScheduledAgents(): ScheduledAgentEntry[] {
    const entries: ScheduledAgentEntry[] = [];
    for (const agent of this.agents.values()) {
      if (!agent.schedule) continue;
      if (!cron.validate(agent.schedule)) {
        throw new Error(
          `Agent "${agent.name}" has invalid cron schedule: "${agent.schedule}"`
        );
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
        try {
          const run = await this.provider.submitRun({ agent, triggeredBy: 'schedule' });
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

  /** True if a cron expression parses cleanly. */
  static isValid(expression: string): boolean {
    return cron.validate(expression);
  }
}
