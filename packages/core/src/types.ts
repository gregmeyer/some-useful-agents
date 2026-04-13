export interface AgentDefinition {
  name: string;
  description?: string;
  type: 'claude-code' | 'shell';

  // Shell agents
  command?: string;

  // Claude-code agents
  prompt?: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];

  // Common
  timeout?: number;
  env?: Record<string, string>;
  schedule?: string;
  allowHighFrequency?: boolean;
  workingDirectory?: string;

  // Chaining (Phase 2a)
  dependsOn?: string[];
  input?: string;

  // Secrets and env control
  secrets?: string[];
  envAllowlist?: string[];
  source?: 'examples' | 'local' | 'community';

  // Community metadata
  author?: string;
  version?: string;
  tags?: string[];
}

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Run {
  id: string;
  agentName: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  result?: string;
  exitCode?: number;
  error?: string;
  triggeredBy: 'cli' | 'mcp' | 'schedule';
}

export interface Provider {
  name: string;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  submitRun(request: { agent: AgentDefinition; triggeredBy: Run['triggeredBy'] }): Promise<Run>;
  getRun(runId: string): Promise<Run | null>;
  listRuns(filter?: { agentName?: string; status?: RunStatus; limit?: number }): Promise<Run[]>;
  cancelRun(runId: string): Promise<void>;
  getRunLogs(runId: string): Promise<string>;
}
