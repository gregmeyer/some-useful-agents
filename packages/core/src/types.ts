export interface AgentInputSpec {
  type: 'string' | 'number' | 'boolean' | 'enum';
  values?: string[];
  default?: string | number | boolean;
  required?: boolean;
  description?: string;
}

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
  /**
   * Typed runtime input declarations. Callers supply values via
   * `--input KEY=value`; YAML defaults fill in the rest. See
   * input-resolver.ts for full semantics.
   */
  inputs?: Record<string, AgentInputSpec>;
  workingDirectory?: string;

  // Chaining (Phase 2a)
  dependsOn?: string[];
  input?: string;

  // Secrets and env control
  secrets?: string[];
  envAllowlist?: string[];
  source?: 'examples' | 'local' | 'community';
  /**
   * Absolute path of the YAML file this agent was loaded from. Populated by
   * the loader; not part of the on-disk schema. Consumers that need to
   * round-trip to the source (e.g. `sua agent edit`) read this.
   */
  filePath?: string;

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
  triggeredBy: 'cli' | 'mcp' | 'schedule' | 'dashboard';
}

export interface RunRequest {
  agent: AgentDefinition;
  triggeredBy: Run['triggeredBy'];
  /**
   * Runtime input values supplied by the caller. Keys must match the
   * agent's declared `inputs:` block; undeclared keys are rejected by
   * `resolveInputs`. Missing values with no default also fail fast.
   */
  inputs?: Record<string, string>;
}

export interface Provider {
  name: string;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  submitRun(request: RunRequest): Promise<Run>;
  getRun(runId: string): Promise<Run | null>;
  listRuns(filter?: { agentName?: string; status?: RunStatus; limit?: number }): Promise<Run[]>;
  cancelRun(runId: string): Promise<void>;
  getRunLogs(runId: string): Promise<string>;
}
