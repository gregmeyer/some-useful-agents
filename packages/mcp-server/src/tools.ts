import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Provider } from '@some-useful-agents/core';
import { loadAgents } from '@some-useful-agents/core';

export function registerTools(server: McpServer, provider: Provider, agentDirs: string[]): void {

  server.tool(
    'list-agents',
    'List available agent definitions',
    {},
    async () => {
      const { agents } = loadAgents({ directories: agentDirs });
      const list = Array.from(agents.values()).map(a => ({
        name: a.name,
        type: a.type,
        description: a.description ?? '',
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
    }
  );

  server.tool(
    'run-agent',
    'Start an agent run',
    { name: z.string().describe('Agent name to run') },
    async ({ name }) => {
      const { agents } = loadAgents({ directories: agentDirs });
      const agent = agents.get(name);
      if (!agent) {
        return { content: [{ type: 'text' as const, text: `Agent "${name}" not found.` }], isError: true };
      }

      const run = await provider.submitRun({ agent, triggeredBy: 'mcp' });

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
        return { content: [{ type: 'text' as const, text: `Run "${runId}" not found.` }], isError: true };
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
