import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  Agent as V2Agent,
  AgentDefinition,
  AgentInputSpec,
  AgentStore,
  IntegrationsStore,
  Provider,
  RunStore,
  SecretsStore,
  ToolStore,
  VariablesStore,
} from '@some-useful-agents/core';
import {
  executeAgentDag,
  loadAgents,
  MissingInputError,
  InvalidInputTypeError,
  UndeclaredInputError,
  SensitiveInputNameError,
} from '@some-useful-agents/core';

/**
 * Discriminated entry for an MCP-exposed agent. v2 agents come from the
 * AgentStore (dashboard / DB-managed) and dispatch through
 * `executeAgentDag`. v1 agents come from filesystem YAML directories
 * (legacy / pre-DB) and dispatch through `provider.submitRun`.
 */
export type McpAgentEntry =
  | { kind: 'v2'; id: string; name: string; description?: string; inputs?: Record<string, AgentInputSpec>; agent: V2Agent }
  | { kind: 'v1'; id: string; name: string; description?: string; inputs?: Record<string, AgentInputSpec>; agent: AgentDefinition };

export interface LoadMcpAgentsOptions {
  /** Primary source for dashboard-managed agents. Filter: mcp=true, status=active. */
  agentStore?: AgentStore;
  /** Legacy filesystem sources. Used for pre-DB v1 YAML files still on disk. */
  agentDirs?: string[];
}

/**
 * Build the map of MCP-exposed agents from both the AgentStore (v2 / DB)
 * and any filesystem directories still holding v1 YAML files. On id
 * collision, the AgentStore entry wins — the DB is the canonical
 * source for any agent that's been dashboard-managed.
 *
 * Only agents that opt in via `mcp: true` are exposed. Non-exposed
 * agents are reported as "not found" rather than "forbidden" so a
 * compromised MCP client cannot enumerate the full catalog.
 */
export function loadMcpExposedAgents(opts: LoadMcpAgentsOptions): Map<string, McpAgentEntry> {
  const exposed = new Map<string, McpAgentEntry>();

  // v2 — AgentStore is the source of truth for dashboard-managed agents.
  if (opts.agentStore) {
    const dbAgents = opts.agentStore.listAgents({ mcp: true, status: 'active' });
    for (const agent of dbAgents) {
      exposed.set(agent.id, {
        kind: 'v2',
        id: agent.id,
        name: agent.name,
        description: agent.description,
        inputs: agent.inputs,
        agent,
      });
    }
  }

  // v1 — legacy filesystem YAML. Skipped when an id already came from
  // the AgentStore (DB wins).
  if (opts.agentDirs && opts.agentDirs.length > 0) {
    const { agents } = loadAgents({ directories: opts.agentDirs });
    for (const [id, def] of agents) {
      if (exposed.has(id)) continue;
      if (def.mcp !== true) continue;
      exposed.set(id, {
        kind: 'v1',
        id,
        name: def.name,
        description: def.description,
        inputs: def.inputs,
        agent: def,
      });
    }
  }

  return exposed;
}

/**
 * Per-value and total caps on the `inputs` map passed to `run-agent`.
 * MCP callers carry the same trust as the bearer-token holder, but the
 * caps defend against runaway prompts and accidental DoS payloads. They
 * apply only at the MCP boundary; dashboard / CLI / scheduler are
 * unaffected.
 */
const MAX_INPUT_VALUE_BYTES = 8 * 1024;
const MAX_INPUT_TOTAL_BYTES = 64 * 1024;

/** Exported for tests; describes a single input spec. */
export function describeInputSpec(spec: AgentInputSpec): Record<string, unknown> {
  const out: Record<string, unknown> = { type: spec.type };
  if (spec.required) out.required = true;
  if (spec.default !== undefined) out.default = spec.default;
  if (spec.description) out.description = spec.description;
  if (spec.type === 'enum' && spec.values) out.values = spec.values;
  return out;
}

function describeInputs(specs: Record<string, AgentInputSpec> | undefined): Record<string, unknown> | undefined {
  if (!specs || Object.keys(specs).length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(specs)) {
    out[name] = describeInputSpec(spec);
  }
  return out;
}

/**
 * Reject oversize input values before they reach `submitRun`. Returns a
 * user-readable error message, or null if the payload is within caps.
 */
/** Exported for tests; returns null if within caps, error message otherwise. */
export function checkInputCaps(inputs: Record<string, string>): string | null {
  let total = 0;
  for (const [k, v] of Object.entries(inputs)) {
    const size = Buffer.byteLength(v, 'utf-8');
    if (size > MAX_INPUT_VALUE_BYTES) {
      return `Input "${k}" is ${size} bytes; the per-value cap is ${MAX_INPUT_VALUE_BYTES} bytes.`;
    }
    total += size;
  }
  if (total > MAX_INPUT_TOTAL_BYTES) {
    return `Total inputs payload is ${total} bytes; the cap is ${MAX_INPUT_TOTAL_BYTES} bytes.`;
  }
  return null;
}

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

export interface RegisterToolsOptions {
  provider: Provider;
  /** v2 source — agents created or managed by the dashboard. */
  agentStore?: AgentStore;
  /**
   * RunStore used for v2 dispatch. Independent connection to the same
   * SQLite DB the provider's internal RunStore uses. SQLite handles
   * multiple connections via WAL; the existing dashboard + scheduler
   * combination has been doing this for releases.
   */
  runStore?: RunStore;
  secretsStore?: SecretsStore;
  variablesStore?: VariablesStore;
  toolStore?: ToolStore;
  integrationsStore?: IntegrationsStore;
  /**
   * Optional data root for the agent-state directory. Required iff
   * any v2 agent expects {{state}} expansion or writes to $STATE_DIR.
   * Almost always set by callers; absent only in stripped-down test rigs.
   */
  dataRoot?: string;
  /** Legacy filesystem source — v1 YAML directories. */
  agentDirs?: string[];
}

export function registerTools(server: McpServer, opts: RegisterToolsOptions): void {
  const loadOpts: LoadMcpAgentsOptions = {
    agentStore: opts.agentStore,
    agentDirs: opts.agentDirs,
  };

  server.tool(
    'list-agents',
    "List agent definitions exposed to MCP (those with `mcp: true`), including each agent's declared inputs schema. Sources both dashboard-managed (DB) and legacy filesystem agents",
    {},
    async () => {
      const agents = loadMcpExposedAgents(loadOpts);
      const list = Array.from(agents.values()).map((entry) => {
        const out: Record<string, unknown> = {
          name: entry.id,
          description: entry.description ?? '',
          source: entry.kind,
        };
        const inputs = describeInputs(entry.inputs);
        if (inputs) out.inputs = inputs;
        return out;
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
    },
  );

  server.tool(
    'run-agent',
    "Start an agent run (only agents with `mcp: true` are runnable). Pass declared inputs via the `inputs` map; call `list-agents` to see each agent's schema",
    {
      name: z.string().describe('Agent name to run'),
      inputs: z.record(z.string(), z.string()).optional().describe(
        'Map of input name → string value. Required inputs without a default must be supplied; undeclared keys are rejected. Values are capped at 8 KB each (64 KB total).',
      ),
    },
    async ({ name, inputs }) => {
      const agents = loadMcpExposedAgents(loadOpts);
      const entry = agents.get(name);
      if (!entry) {
        return errorResult(`Agent "${name}" not found.`);
      }

      const provided = inputs ?? {};
      const capError = checkInputCaps(provided);
      if (capError) return errorResult(capError);

      // v2 dispatch path — executeAgentDag. Requires runStore at minimum;
      // missing deps make the run fail with category=setup, surfaced as
      // an MCP error here.
      if (entry.kind === 'v2') {
        if (!opts.runStore) {
          return errorResult(`Agent "${name}" is a v2 (DAG) agent but MCP was started without a runStore. Reinstall or restart sua so the DB-backed dispatcher wires up.`);
        }
        try {
          const run = await executeAgentDag(
            entry.agent,
            { triggeredBy: 'mcp', inputs: provided },
            {
              runStore: opts.runStore,
              secretsStore: opts.secretsStore,
              agentStore: opts.agentStore,
              variablesStore: opts.variablesStore,
              toolStore: opts.toolStore,
              integrationsStore: opts.integrationsStore,
              dataRoot: opts.dataRoot,
            },
          );
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                id: run.id,
                status: run.status,
                result: run.result,
                error: run.error,
                exitCode: run.exitCode,
              }, null, 2),
            }],
            isError: run.status === 'failed',
          };
        } catch (err) {
          if (
            err instanceof MissingInputError ||
            err instanceof InvalidInputTypeError ||
            err instanceof UndeclaredInputError ||
            err instanceof SensitiveInputNameError
          ) {
            return errorResult(err.message);
          }
          throw err;
        }
      }

      // v1 dispatch path — provider.submitRun. The legacy AgentDefinition
      // shape submitRun expects.
      let run;
      try {
        run = await opts.provider.submitRun({ agent: entry.agent, triggeredBy: 'mcp', inputs: provided });
      } catch (err) {
        if (
          err instanceof MissingInputError ||
          err instanceof InvalidInputTypeError ||
          err instanceof UndeclaredInputError ||
          err instanceof SensitiveInputNameError
        ) {
          return errorResult(err.message);
        }
        throw err;
      }

      // Wait for completion (with timeout)
      const timeout = (entry.agent.timeout ?? 300) * 1000 + 5000;
      const start = Date.now();
      let current = run;
      while ((current.status === 'running' || current.status === 'pending') && Date.now() - start < timeout) {
        await new Promise((r) => setTimeout(r, 500));
        const updated = await opts.provider.getRun(run.id);
        if (updated) current = updated;
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            id: current.id,
            status: current.status,
            result: current.result,
            error: current.error,
            exitCode: current.exitCode,
          }, null, 2),
        }],
        isError: current.status === 'failed',
      };
    },
  );

  server.tool(
    'get-status',
    'Get the status of a run',
    { runId: z.string().describe('Run ID') },
    async ({ runId }) => {
      const run = await opts.provider.getRun(runId);
      if (!run) {
        return errorResult(`Run "${runId}" not found.`);
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(run, null, 2) }] };
    },
  );

  server.tool(
    'get-logs',
    'Get logs for a run',
    { runId: z.string().describe('Run ID') },
    async ({ runId }) => {
      const logs = await opts.provider.getRunLogs(runId);
      return { content: [{ type: 'text' as const, text: logs || '(no output)' }] };
    },
  );

  server.tool(
    'cancel-agent',
    'Cancel a running agent',
    { runId: z.string().describe('Run ID to cancel') },
    async ({ runId }) => {
      await opts.provider.cancelRun(runId);
      return { content: [{ type: 'text' as const, text: `Cancelled run ${runId}` }] };
    },
  );

  server.tool(
    'list-runs',
    'List recent runs',
    {
      agentName: z.string().optional().describe('Filter by agent name'),
      limit: z.number().optional().default(20).describe('Max results'),
    },
    async ({ agentName, limit }) => {
      const runs = await opts.provider.listRuns({ agentName, limit });
      const summary = runs.map((r) => ({
        id: r.id,
        agent: r.agentName,
        status: r.status,
        started: r.startedAt,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    },
  );
}
