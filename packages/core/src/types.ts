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
  /**
   * Whether this agent is exposed via the MCP server. Defaults to false —
   * agents must opt in to be callable from MCP clients.
   */
  mcp?: boolean;
  /**
   * When true, scrub known-prefix secrets from captured stdout/stderr
   * before they land in the run store.
   */
  redactSecrets?: boolean;
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
