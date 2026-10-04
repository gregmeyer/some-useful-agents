import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
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
  runAgentTurn,
  SessionStore,
  NotConversationalError,
  SessionNotFoundError,
  ChatMessageError,
  loadAgents,
  MissingInputError,
  InvalidInputTypeError,
  UndeclaredInputError,
  SensitiveInputNameError,
  BoardsStore,
  BoardBuildStore,
  queueBoardBuild,
  type DashboardsStore,
  getBuiltinTool,
  evaluatePolicy,
  resolvePolicyDocument,
  policyResource, collectItems, itemSourcesFromHandle, ITEM_KINDS, SurfaceStore, SurfaceNeedsApproval, compileSurface
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
  /** Named dashboards, for build-board (a new board is a user dashboard). */
  dashboardsStore?: DashboardsStore;
}

export function registerTools(server: McpServer, opts: RegisterToolsOptions): void {
  const loadOpts: LoadMcpAgentsOptions = {
    agentStore: opts.agentStore,
    agentDirs: opts.agentDirs,
  };

  server.registerTool(
    'list-agents',
    {
      description:
        "List agent definitions exposed to MCP (those with `mcp: true`), including each agent's declared inputs schema. Sources both dashboard-managed (DB) and legacy filesystem agents",
      inputSchema: {},
    },
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
        // Routing metadata (v2 agents only) — lets an external client pick the
        // right agent on entry conditions / sample questions, not just the
        // description. Omitted when empty.
        if (entry.kind === 'v2') {
          const a = entry.agent;
          if (a.entryConditions?.length) out.entryConditions = a.entryConditions;
          if (a.nonEntryConditions?.length) out.nonEntryConditions = a.nonEntryConditions;
          if (a.sampleQuestions?.length) out.sampleQuestions = a.sampleQuestions;
        }
        return out;
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
    },
  );

  server.registerTool(
    'run-agent',
    {
      description:
        "Start an agent run (only agents with `mcp: true` are runnable). Pass declared inputs via the `inputs` map; call `list-agents` to see each agent's schema. To hold a conversation, pass `message` (it fills the agent's chat input) and, from the second turn on, the `sessionId` the previous call returned: the agent then sees the conversation so far.",
      inputSchema: {
        name: z.string().describe('Agent name to run'),
        inputs: z.record(z.string(), z.string()).optional().describe(
          'Map of input name → string value. Required inputs without a default must be supplied; undeclared keys are rejected. Values are capped at 8 KB each (64 KB total).',
        ),
        message: z.string().optional().describe(
          'A chat message for the agent (fills its chat input). Starts a conversation, or continues one with sessionId. The result includes sessionId.',
        ),
        sessionId: z.string().optional().describe(
          'Continue an earlier conversation: the sessionId returned by a previous run-agent call with a message.',
        ),
      },
    },
    async ({ name, inputs, message, sessionId }) => {
      const agents = loadMcpExposedAgents(loadOpts);
      const entry = agents.get(name);
      if (!entry) {
        return errorResult(`Agent "${name}" not found.`);
      }

      const provided = inputs ?? {};
      const capError = checkInputCaps(provided);
      if (capError) return errorResult(capError);

      // Conversation turn (docs/conversations.md): v2 agents only.
      if (message !== undefined || sessionId !== undefined) {
        if (message === undefined) return errorResult('sessionId needs a message to send.');
        if (entry.kind !== 'v2' || !opts.runStore) {
          return errorResult(`Agent "${name}" can't hold a conversation over MCP (only DB-managed agents can).`);
        }
        try {
          const turn = await runAgentTurn({
            agent: entry.agent,
            sessions: SessionStore.fromHandle(opts.runStore.databaseHandle()),
            message,
            sessionId,
            inputs: provided,
            triggeredBy: 'mcp',
            deps: {
              runStore: opts.runStore,
              secretsStore: opts.secretsStore,
              agentStore: opts.agentStore,
              variablesStore: opts.variablesStore,
              toolStore: opts.toolStore,
              integrationsStore: opts.integrationsStore,
              dataRoot: opts.dataRoot,
            },
          });
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                sessionId: turn.sessionId,
                id: turn.run.id,
                status: turn.run.status,
                reply: turn.reply?.text,
                error: turn.run.error,
                ...(turn.run.status === 'waiting' ? { note: 'The agent is waiting for a person to answer a question in the sua inbox. Call run-agent again with this sessionId later; the reply is added to the conversation once the run finishes.' } : {}),
              }, null, 2),
            }],
            isError: turn.run.status === 'failed',
          };
        } catch (err) {
          if (
            err instanceof NotConversationalError ||
            err instanceof SessionNotFoundError ||
            err instanceof MissingInputError ||
            err instanceof InvalidInputTypeError ||
            err instanceof UndeclaredInputError ||
            err instanceof SensitiveInputNameError ||
            err instanceof ChatMessageError
          ) {
            return errorResult(err.message);
          }
          throw err;
        }
      }

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

  // Boards: let an MCP client (Claude Desktop, Codex…) read and arrange Pulse
  // or a named dashboard, through the same board-read / board-place tools an
  // agent uses — same validation, same tool policy, same undoable versions.
  const boardsStore = (() => {
    try { return opts.runStore ? new BoardsStore(opts.runStore.databaseHandle()) : undefined; } catch { return undefined; }
  })();
  const runBoardTool = async (toolId: 'board-read' | 'board-place', args: Record<string, unknown>) => {
    if (!boardsStore) return errorResult('Boards are not available on this server.');
    if (opts.dataRoot) {
      const decision = evaluatePolicy(resolvePolicyDocument(opts.dataRoot), {
        toolId, resource: policyResource(toolId, args), agentSource: 'local', agentId: 'mcp',
      });
      if (decision.effect === 'deny') return errorResult(decision.reason ?? `Policy denies "${toolId}".`);
    }
    const out = await getBuiltinTool(toolId)!.execute(args, { boards: boardsStore });
    return { content: [{ type: 'text' as const, text: String(out.result ?? '') }], ...(out.isError ? { isError: true } : {}) };
  };

  server.registerTool(
    'board-read',
    {
      description: 'See how a sua board (Pulse, or a named dashboard) is laid out: an outline of its sections, tabs, rows, grids and tiles with the ids board-place needs, and its version. Omit board to list the boards.',
      inputSchema: { board: z.string().optional().describe('Board id: "pulse" or a dashboard id like "user:morning-briefing".') },
    },
    async ({ board }) => runBoardTool('board-read', { board: board ?? '' }),
  );

  server.registerTool(
    'board-place',
    {
      description: getBuiltinTool('board-place')!.definition.description,
      inputSchema: {
        board: z.string().describe('Board id: "pulse" or a dashboard id.'),
        ops: z.array(z.record(z.string(), z.unknown())).describe('Tree operations in order: insert / move / remove / wrap / unwrap / set / span (see the tool description). ids come from board-read.'),
        version: z.number().optional().describe('The version you read; if the board changed since, nothing is saved.'),
      },
    },
    async ({ board, ops, version }) => runBoardTool('board-place', { board, ops, ...(version !== undefined ? { version } : {}) }),
  );

  // Build a whole board from a request (docs/boards.md § Build a board). The
  // build itself runs in the dashboard (it drafts agents and runs tiles), so
  // this queues it in the shared database; the dashboard picks it up within
  // seconds and posts "your board is ready" to the sua inbox.
  const builds = (() => {
    try { return opts.runStore ? new BoardBuildStore(opts.runStore.databaseHandle()) : undefined; } catch { return undefined; }
  })();
  const policyAllows = (toolId: string): string | undefined => {
    if (!opts.dataRoot) return undefined;
    const d = evaluatePolicy(resolvePolicyDocument(opts.dataRoot), { toolId, resource: '', agentSource: 'local', agentId: 'mcp' });
    return d.effect === 'deny' ? (d.reason ?? `Policy denies "${toolId}".`) : undefined;
  };
  server.registerTool(
    'build-board',
    {
      description: 'Build a sua board from a request: sua picks the right agents from the person\'s catalog, lays out a new board, runs every tile, drafts agents for anything not covered (the person approves those in the sua inbox), and posts "your board is ready" to the inbox. Returns the new board and a build id; it takes a minute or two (check with board-build-status).',
      inputSchema: {
        request: z.string().describe('What the board should show, in the person\'s words, e.g. "a morning board with the weather in Seattle, the markets and my job leads".'),
        name: z.string().optional().describe('Optional short board name.'),
      },
    },
    async ({ request, name }) => {
      const denied = policyAllows('build-board');
      if (denied) return errorResult(denied);
      if (!opts.runStore || !opts.dashboardsStore) return errorResult('Boards are not available on this server.');
      try {
        const { boardId, build } = queueBoardBuild(opts.runStore.databaseHandle(), opts.dashboardsStore, { request, ...(name ? { name } : {}), queued: true, origin: 'mcp' });
        return { content: [{ type: 'text' as const, text: `Queued the board "${name?.trim() || boardId.replace(/^user:/, '')}" (board ${boardId}, build ${build.id}). The sua dashboard builds it now: open /dashboards/${encodeURIComponent(boardId)} there. Check progress with board-build-status; the person's inbox says when it's ready.` }] };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
  server.registerTool(
    'items-read',
    {
      description: 'What needs the person\'s attention in sua right now, most urgent first: threads waiting on them (approvals, answers, failures), questions runs are waiting on, agents that keep failing or missed their declared outcome, draft agents, board builds, and the scheduler\'s health. Each item has a stable id, a kind (decision, question, alert, status, progress…), what it\'s about, and the actions it supports.',
      inputSchema: {
        kind: z.array(z.enum(ITEM_KINDS)).optional().describe('Only these kinds, e.g. ["decision","question"].'),
        agent: z.string().optional().describe('Only items about this agent id.'),
        includeOk: z.boolean().optional().describe('Include healthy context items (e.g. the scheduler when it is running). Default false.'),
        limit: z.number().int().min(1).max(200).optional().describe('At most this many (default 50).'),
        format: z.enum(['text', 'json']).optional().describe('text (default): one line per item. json: the full items.'),
      },
    },
    async ({ kind, agent, includeOk, limit, format }) => {
      if (!opts.runStore || !opts.agentStore) return errorResult('Items are not available on this server.');
      try {
        const sources = itemSourcesFromHandle(opts.runStore.databaseHandle(), opts.agentStore, opts.runStore, opts.dataRoot);
        const items = collectItems(sources, {
          ...(kind?.length ? { kinds: kind } : {}),
          ...(agent ? { agentId: agent } : {}),
          includeOk: includeOk ?? false,
          limit: limit ?? 50,
        });
        if (format === 'json') return { content: [{ type: 'text' as const, text: JSON.stringify(items, null, 2) }] };
        if (items.length === 0) return { content: [{ type: 'text' as const, text: 'Nothing needs attention right now.' }] };
        const lines = items.map((i) => `[${i.urgency}] ${i.kind} · ${i.title}${i.summary ? ` — ${i.summary}` : ''} (${i.id}; ${i.actions.map((a) => a.label).join(' / ')})`);
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
  const homeNow = () => {
    const db = opts.runStore!.databaseHandle();
    const items = collectItems(itemSourcesFromHandle(db, opts.agentStore!, opts.runStore!, opts.dataRoot));
    const store = SurfaceStore.fromHandle(db);
    const cur = store.current('home');
    return { store, cur, compiled: compileSurface(cur.doc, items) };
  };
  server.registerTool(
    'surface-read',
    {
      description: 'How sua\'s Home is arranged right now: its goal, sections in order with the items in each (ids, kind, title, why each is where it is), its rules, and what is hidden. Use the item and rule ids with surface-apply.',
      inputSchema: {},
    },
    async () => {
      if (!opts.runStore || !opts.agentStore) return errorResult('Home is not available on this server.');
      try {
        const { cur, compiled } = homeNow();
        const lines = [`Home v${String(cur.version)}. Goal: ${cur.doc.goal}`];
        for (const r of compiled.regions) {
          lines.push(`## ${r.title} (${r.id})${r.more ? ` +${String(r.more)} more` : ''}`);
          for (const e of r.entries.slice(0, 25)) lines.push(`- ${e.item.id} · ${e.item.kind} · ${e.item.title}${e.collapsed ? ' (folded)' : ''} — ${e.reasons[0] ?? ''}`);
        }
        lines.push(`Rules (newest first): ${cur.doc.rules.map((x) => `${x.id} [${x.type}] ${x.label ?? ''}`).join('; ') || 'none'}`);
        if (compiled.hidden.length) lines.push(`Hidden: ${compiled.hidden.filter((h) => h.by).map((h) => h.itemId).join(', ') || 'none'}`);
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
  server.registerTool(
    'surface-apply',
    {
      description: 'Change how sua\'s Home is arranged with surface ops (the same ones its Today tab uses): setGoal, addRule / removeRule (promote, hide, filter, collapse, group, represent), pin / unpin, rank, hide / show, expand / collapse, group / ungroup. Saved as a new version marked as made by this app; the person can undo it. Changes to Home\'s sections themselves (addRegion, removeRegion, moveRegion, renameRegion) are refused: the person makes those.',
      inputSchema: {
        ops: z.array(z.record(z.string(), z.unknown())).min(1).max(20).describe('Surface ops, e.g. [{"op":"pin","itemId":"agent:news:failing"}] or [{"op":"addRule","rule":{"id":"failing-first","type":"promote","match":{"idPrefix":"agent:","kinds":["alert"]},"label":"failing agents first"}}]. Read item and rule ids with surface-read.'),
        reason: z.string().max(280).describe('Why, in a few words; shown in Home\'s history.'),
        expectedVersion: z.number().int().min(0).optional().describe('The version surface-read showed; refuses if Home changed since.'),
      },
    },
    async ({ ops, reason, expectedVersion }) => {
      const denied = policyAllows('surface-apply');
      if (denied) return errorResult(denied);
      if (!opts.runStore || !opts.agentStore) return errorResult('Home is not available on this server.');
      try {
        const { store } = homeNow();
        const saved = store.apply('home', ops, 'agent:mcp', reason, expectedVersion !== undefined ? { expectedVersion } : {});
        return { content: [{ type: 'text' as const, text: `Saved. Home is now v${String(saved.version)}. The person sees the change on Home and can undo it.` }] };
      } catch (err) {
        if (err instanceof SurfaceNeedsApproval) return errorResult('That changes Home\'s sections, which the person does themselves (on Home, or by asking sua). Rules, pins and hides within sections are fine.');
        return errorResult((err as Error).message);
      }
    },
  );
  server.registerTool(
    'board-build-status',
    {
      description: 'How a build-board build is going: its phase (queued, planning, arranging, running, drafting, done, failed), the agents placed, any that failed, the parts no agent covered, and whether drafted agents await approval.',
      inputSchema: { build: z.string().describe('The build id build-board returned.') },
    },
    async ({ build }) => {
      if (!builds) return errorResult('Boards are not available on this server.');
      const b = builds.get(build);
      if (!b) return errorResult(`No build "${build}".`);
      const lines = [
        `Board ${b.boardId}: ${b.phase}. ${b.detail}`,
        ...(b.placed.length ? [`Placed: ${b.placed.join(', ')}`] : []),
        ...(b.failed.length ? [`Didn't run cleanly: ${b.failed.join(', ')}`] : []),
        ...(b.missing.length ? [`Not covered by existing agents: ${b.missing.map((m) => m.purpose).join('; ')}`] : []),
        ...(b.drafts.filter((d) => d.ok).length ? [`Drafted (${b.approval ?? 'pending'}): ${b.drafts.filter((d) => d.ok).map((d) => d.id).join(', ')} — the person approves these in the sua inbox.`] : []),
        ...(b.error ? [`Error: ${b.error}`] : []),
      ];
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  server.registerTool(
    'get-status',
    { description: 'Get the status of a run', inputSchema: { runId: z.string().describe('Run ID') } },
    async ({ runId }) => {
      const run = await opts.provider.getRun(runId);
      if (!run) {
        return errorResult(`Run "${runId}" not found.`);
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(run, null, 2) }] };
    },
  );

  server.registerTool(
    'get-logs',
    { description: 'Get logs for a run', inputSchema: { runId: z.string().describe('Run ID') } },
    async ({ runId }) => {
      const logs = await opts.provider.getRunLogs(runId);
      return { content: [{ type: 'text' as const, text: logs || '(no output)' }] };
    },
  );

  server.registerTool(
    'cancel-agent',
    { description: 'Cancel a running agent', inputSchema: { runId: z.string().describe('Run ID to cancel') } },
    async ({ runId }) => {
      await opts.provider.cancelRun(runId);
      return { content: [{ type: 'text' as const, text: `Cancelled run ${runId}` }] };
    },
  );

  server.registerTool(
    'list-runs',
    {
      description: 'List recent runs',
      inputSchema: {
        agentName: z.string().optional().describe('Filter by agent name'),
        limit: z.number().optional().default(20).describe('Max results'),
      },
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
