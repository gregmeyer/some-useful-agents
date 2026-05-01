import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentDefinition, AgentInputSpec, Provider } from '@some-useful-agents/core';
import {
  loadAgents,
  MissingInputError,
  InvalidInputTypeError,
  UndeclaredInputError,
  SensitiveInputNameError,
} from '@some-useful-agents/core';

/**
 * Only agents that opt in via `mcp: true` in their YAML are exposed to MCP
 * clients. Non-exposed agents are reported as "not found" rather than
 * "forbidden" so a compromised MCP client cannot enumerate the user's full
 * agent catalog. Use `sua agent list` from the CLI to see everything.
 */
export function loadMcpExposedAgents(agentDirs: string[]): Map<string, AgentDefinition> {
  const { agents } = loadAgents({ directories: agentDirs });
  const exposed = new Map<string, AgentDefinition>();
  for (const [name, agent] of agents) {
    if (agent.mcp === true) exposed.set(name, agent);
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

export function registerTools(server: McpServer, provider: Provider, agentDirs: string[]): void {

  server.tool(
    'list-agents',
    'List agent definitions exposed to MCP (those with `mcp: true` in YAML), including each agent\'s declared inputs schema',
    {},
    async () => {
      const agents = loadMcpExposedAgents(agentDirs);
      const list = Array.from(agents.values()).map(a => {
        const entry: Record<string, unknown> = {
          name: a.name,
          type: a.type,
          description: a.description ?? '',
        };
        const inputs = describeInputs(a.inputs);
        if (inputs) entry.inputs = inputs;
        return entry;
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
    }
  );

  server.tool(
    'run-agent',
    'Start an agent run (only agents with `mcp: true` are runnable). Pass declared inputs via the `inputs` map; call `list-agents` to see each agent\'s schema',
    {
      name: z.string().describe('Agent name to run'),
      inputs: z.record(z.string(), z.string()).optional().describe(
        'Map of input name → string value. Required inputs without a default must be supplied; undeclared keys are rejected. Values are capped at 8 KB each (64 KB total).',
      ),
    },
    async ({ name, inputs }) => {
      const agents = loadMcpExposedAgents(agentDirs);
      const agent = agents.get(name);
      if (!agent) {
        return errorResult(`Agent "${name}" not found.`);
      }

      const provided = inputs ?? {};
      const capError = checkInputCaps(provided);
      if (capError) return errorResult(capError);

      let run;
      try {
        run = await provider.submitRun({ agent, triggeredBy: 'mcp', inputs: provided });
      } catch (err) {
        // Surface input-validation errors as MCP errors with the user-readable
        // message instead of a 500. Anything else is unexpected — re-throw so
        // the SDK turns it into the standard error envelope.
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
      const timeout = (agent.timeout ?? 300) * 1000 + 5000;
      const start = Date.now();
      let current = run;
      while ((current.status === 'running' || current.status === 'pending') && Date.now() - start < timeout) {
        await new Promise(r => setTimeout(r, 500));
        const updated = await provider.getRun(run.id);
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
    }
  );

  server.tool(
    'get-status',
    'Get the status of a run',
    { runId: z.string().describe('Run ID') },
    async ({ runId }) => {
      const run = await provider.getRun(runId);
      if (!run) {
        return errorResult(`Run "${runId}" not found.`);
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(run, null, 2) }] };
    }
  );

  server.tool(
    'get-logs',
    'Get logs for a run',
    { runId: z.string().describe('Run ID') },
    async ({ runId }) => {
      const logs = await provider.getRunLogs(runId);
      return { content: [{ type: 'text' as const, text: logs || '(no output)' }] };
    }
  );

  server.tool(
    'cancel-agent',
    'Cancel a running agent',
    { runId: z.string().describe('Run ID to cancel') },
    async ({ runId }) => {
      await provider.cancelRun(runId);
      return { content: [{ type: 'text' as const, text: `Cancelled run ${runId}` }] };
    }
  );

  server.tool(
    'list-runs',
    'List recent runs',
    {
      agentName: z.string().optional().describe('Filter by agent name'),
      limit: z.number().optional().default(20).describe('Max results'),
    },
    async ({ agentName, limit }) => {
      const runs = await provider.listRuns({ agentName, limit });
      const summary = runs.map(r => ({
        id: r.id,
        agent: r.agentName,
        status: r.status,
        started: r.startedAt,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );
}
