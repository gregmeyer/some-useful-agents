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
  NotebookStore,
  NOTEBOOK_READ_PARTS,
  EXPERIMENT_READ_PARTS,
  type BuiltinToolContext,
  BoardBuildStore,
  queueBoardBuild,
  NotebookRequestStore,
  checkNotebookRequest,
  describeNotebookTemplate,
  templatesForAsk,
  findNotebook,
  notebookReadoutJson,
  NOTEBOOK_SURFACE_URI,
  A2UI_MIME,
  notebookSurfaceTemplate,
  notebookSurfaceData,
  cleanTldrSpec,
  strayTldrNumbers,
  tldrOptionsGuide,
  TLDR_SIZES,
  TLDR_TONES,
  TLDR_LAYOUTS,
  TLDR_PARTS,
  type TldrSpec,
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
  // Notebooks: what one knows (notebook-read), for an MCP client the same as for an agent. Read only.
  const notebookStore = (() => {
    try { return opts.runStore ? NotebookStore.fromHandle(opts.runStore.databaseHandle()) : undefined; } catch { return undefined; }
  })();
  // A builtin, behind the same tool policy an agent's call goes through.
  const runBuiltinTool = async (toolId: 'board-read' | 'board-place' | 'notebook-read' | 'experiment-read', args: Record<string, unknown>, ctx: BuiltinToolContext) => {
    if (opts.dataRoot) {
      const decision = evaluatePolicy(resolvePolicyDocument(opts.dataRoot), {
        toolId, resource: policyResource(toolId, args), agentSource: 'local', agentId: 'mcp',
      });
      if (decision.effect === 'deny') return errorResult(decision.reason ?? `Policy denies "${toolId}".`);
    }
    const out = await getBuiltinTool(toolId)!.execute(args, ctx);
    return { content: [{ type: 'text' as const, text: String(out.result ?? '') }], ...(out.isError ? { isError: true } : {}) };
  };
  const runBoardTool = async (toolId: 'board-read' | 'board-place', args: Record<string, unknown>) =>
    boardsStore ? runBuiltinTool(toolId, args, { boards: boardsStore }) : errorResult('Boards are not available on this server.');

  server.registerTool(
    'notebook-read',
    {
      description: getBuiltinTool('notebook-read')!.definition.description,
      inputSchema: {
        notebook: z.string().optional().describe('The notebook: its id, a /notebooks/<id> link, or words from its title. Omit to list notebooks.'),
        part: z.enum(NOTEBOOK_READ_PARTS).optional().describe('One part only (default all). "written" is its answer, write-up, talking points and plan.'),
        format: z.enum(['text', 'json']).optional().describe('text (default) or json.'),
      },
    },
    async ({ notebook, part, format }) => {
      if (!notebookStore) return errorResult('Notebooks are not available on this server.');
      const out = await runBuiltinTool('notebook-read', { notebook: notebook ?? '', ...(part ? { part } : {}), ...(format ? { format } : {}) }, { notebooks: notebookStore });
      if ('isError' in out && out.isError) return out;
      // One notebook, read whole: its data as an A2UI 1.0 updateDataModel for the a2ui://notebook layout (ADR-0090),
      // so a host that draws A2UI shows it as a page; the text stays for every other host.
      const found = notebook && (!part || part === 'all') ? findNotebook(notebookStore, notebook) : undefined;
      if (!found || !('notebook' in found)) return out;
      const data = notebookSurfaceData(notebookReadoutJson(found.notebook, notebookStore.entries(found.notebook.id, 1000)));
      return {
        ...out,
        content: [...out.content, { type: 'resource' as const, resource: { uri: `${NOTEBOOK_SURFACE_URI}/data/${encodeURIComponent(found.notebook.id)}`, mimeType: A2UI_MIME, text: JSON.stringify([data]) } }],
        _meta: { ui: { resourceUri: NOTEBOOK_SURFACE_URI, mimeType: A2UI_MIME } },
      };
    },
  );

  // A notebook's page layout for an MCP host that draws A2UI (ADR-0090): basic components only, every value bound to the data notebook-read returns.
  server.registerResource('notebook-surface', NOTEBOOK_SURFACE_URI, { title: 'A notebook, as an A2UI page', description: 'The A2UI 1.0 layout notebook-read\'s data fills (basic catalog only).', mimeType: A2UI_MIME },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: A2UI_MIME, text: JSON.stringify(notebookSurfaceTemplate()) }] }));

  // Experiments: what one found (experiment-read). Read only; they are kept beside notebooks.
  server.registerTool(
    'experiment-read',
    {
      description: getBuiltinTool('experiment-read')!.definition.description,
      inputSchema: {
        experiment: z.string().optional().describe('The experiment: its id, a /experiments/<id> link, or words from its name. Omit to list experiments.'),
        part: z.enum(EXPERIMENT_READ_PARTS).optional().describe('One part only (default all).'),
        format: z.enum(['text', 'json']).optional().describe('text (default) or json.'),
      },
    },
    async ({ experiment, part, format }) => notebookStore
      ? runBuiltinTool('experiment-read', { experiment: experiment ?? '', ...(part ? { part } : {}), ...(format ? { format } : {}) }, { notebooks: notebookStore })
      : errorResult('Experiments are not available on this server.'),
  );

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
      description: 'Change how sua\'s Home is arranged with surface ops (the same ones its Today tab uses): setGoal, addRule / removeRule (promote, hide, filter, collapse, group, represent), pin / unpin, rank, hide / show, expand / collapse, group / ungroup. Saved as a new version marked as made by this app; the person can undo it. Changes to Home\'s sections themselves (addRegion, removeRegion, moveRegion, renameRegion) and to the page\'s parts (movePart, hidePart, showPart) are refused: the person makes those.',
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

  // Start a notebook (docs/notebooks.md § Notebooks from elsewhere). Making one
  // runs in the dashboard (setup, drafting an ask, its first step), so this
  // queues it in the shared database, like build-board; the dashboard makes it
  // within seconds and notebook-create-status says when it's there.
  const notebookRequests = (() => {
    try { return opts.runStore ? new NotebookRequestStore(opts.runStore.databaseHandle()) : undefined; } catch { return undefined; }
  })();
  server.registerTool(
    'notebook-templates',
    {
      description: 'List the person\'s sua notebook templates, the notebooks they set up the way they like and start again for someone or something new (a company briefing, meeting prep, a job search…). For each: its id, what it is for, its steps, the page it opens on, and what it needs to be told (its subject). Call this before notebook-create and use the template that fits what the person asked for.',
      inputSchema: {},
    },
    async () => {
      if (!notebookStore) return errorResult('Notebooks are not available on this server.');
      const ts = notebookStore.listTemplates(50);
      if (!ts.length) return { content: [{ type: 'text' as const, text: 'No templates yet. Start a notebook from an ask instead (notebook-create with ask), or the person can save one from a notebook\'s Edit panel.' }] };
      return { content: [{ type: 'text' as const, text: `Templates (most used first). Pick the one whose "For" matches what the person wants: a meeting briefing prepares for a meeting with someone, a company briefing is about a company with no meeting in view.\n\n${ts.map(describeNotebookTemplate).join('\n\n')}` }] };
    },
  );
  server.registerTool(
    'notebook-create',
    {
      description: 'Start a new sua notebook, as New notebook in the dashboard would. Prefer one of the person\'s templates when one fits (list them with notebook-templates): pass template + subject, e.g. a company briefing on "Acme". Use ask (a sentence sua drafts a notebook from, e.g. "Tell me about roadschooling") only when no template fits; if one looks like it does, nothing is started and the reply names it, so call again with that template, or with fresh: true to draft a new one anyway. Returns a request id; the dashboard makes the notebook within seconds (an ask takes a minute to draft). Check with notebook-create-status, then read it with notebook-read. It waits for the person to press Next step unless start is true.',
      inputSchema: {
        template: z.string().optional().describe('A template id or words from its name (list them with notebook-templates). Give this or ask.'),
        subject: z.string().optional().describe('Who or what it\'s about, for a template that needs one (e.g. a company or person name).'),
        ask: z.string().optional().describe('What the notebook is for, in a sentence, when not starting from a template (e.g. "Tell me about Acme, acme.com").'),
        title: z.string().optional().describe('Optional title.'),
        start: z.boolean().optional().describe('Start its first step once it\'s made (default false: it waits for the person).'),
        fresh: z.boolean().optional().describe('With ask: draft a new notebook even when one of their templates looks like it fits.'),
      },
    },
    async ({ template, subject, ask, title, start, fresh }) => {
      const denied = policyAllows('notebook-create');
      if (denied) return errorResult(denied);
      if (!notebookStore || !notebookRequests) return errorResult('Notebooks are not available on this server.');
      const checked = checkNotebookRequest(notebookStore, { template, subject, ask, title, start, origin: 'mcp' });
      if ('error' in checked) return errorResult(checked.error);
      // An ask one of their templates fits: say so before drafting a notebook they have a better start for.
      if (checked.ask && !fresh) {
        const fits = templatesForAsk(checked.ask, notebookStore.listTemplates(50));
        if (fits.length) {
          return { content: [{ type: 'text' as const, text: `Nothing started yet: ${fits.length === 1 ? 'one of the person\'s templates looks like it fits' : 'some of the person\'s templates look like they fit'} this ask.\n\n${fits.map(describeNotebookTemplate).join('\n\n')}\n\nTo use one, call notebook-create again with template: "${fits[0]!.id}"${fits[0]!.setup.subject ? ' and subject (who or what it\'s about)' : ''}. If none is right, call again with the same ask and fresh: true.` }] };
        }
      }
      const r = notebookRequests.create(checked);
      return { content: [{ type: 'text' as const, text: `Queued a new notebook ${checked.template ? `from the template "${checked.template}"${checked.subject ? ` about ${checked.subject}` : ''}` : 'from the ask'} (request ${r.id}). The sua dashboard makes it ${checked.ask ? 'in about a minute (sua drafts it first)' : 'within seconds'}; check with notebook-create-status.` }] };
    },
  );
  server.registerTool(
    'notebook-create-status',
    {
      description: 'How a notebook-create request is going: queued, drafting, creating, ready (with the new notebook\'s id and link) or failed (with why).',
      inputSchema: { request: z.string().describe('The request id notebook-create returned.') },
    },
    async ({ request }) => {
      if (!notebookRequests) return errorResult('Notebooks are not available on this server.');
      const r = notebookRequests.get(request);
      if (!r) return errorResult(`No notebook request "${request}".`);
      const nb = r.notebookId ? notebookStore?.get(r.notebookId) : undefined;
      const lines = [
        `${r.phase}. ${r.detail}`,
        ...(r.notebookId ? [`Notebook: ${r.notebookId}${nb ? ` ("${nb.title}")` : ''}, at /notebooks/${encodeURIComponent(r.notebookId)}. Read it with notebook-read.`] : []),
        ...(nb?.steps?.length ? [`Steps: ${nb.steps.map((st) => `${st.title} (${st.status})`).join(' → ')}`] : []),
        ...(r.error ? [`Error: ${r.error}`] : []),
      ];
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  // Redraw a notebook's TL;DR picture (docs/notebooks.md § The TL;DR picture), as Redraw… in the
  // dashboard does: the caller chooses how it's drawn (a size, tone, layout, which parts, and at
  // most a headline and a takeaway) and the notebook keeps that (Undo puts the one before back).
  // The dashboard draws it from the notebook's own data, so a name, number or bar never comes
  // from the caller; a number in the headline or takeaway must be one the notebook has.
  const tldrLine = (s: TldrSpec | undefined): string => (s
    ? `${TLDR_SIZES[s.size].name} ${String(TLDR_SIZES[s.size].width)}×${TLDR_SIZES[s.size].height ? String(TLDR_SIZES[s.size].height) : 'auto'}, ${s.tone}, ${s.layout}; parts: ${s.parts.join(', ')}${s.bars ? `; ${String(s.bars)} bars` : ''}${s.headline ? `; headline: "${s.headline}"` : ''}${s.takeaway ? `; takeaway: "${s.takeaway}"` : ''}`
    : 'the standard picture (standard size, plain, stacked, every part)');
  const keys = <T extends string>(o: Record<T, unknown>) => Object.keys(o) as [T, ...T[]];
  server.registerTool(
    'notebook-tldr',
    {
      description: `Redraw a sua notebook's TL;DR picture, the one-image summary it shares as a PNG (for a message, a LinkedIn or X post, a slide), as Redraw… in the dashboard does. You choose how it's drawn; sua draws it from the notebook's own data, so names, numbers and bars always come from the notebook. action "show" (the default with nothing else given) says how it's drawn now and what you can choose; "draw" sets the fields you give and keeps the rest as they are now; "undo" puts back the one before; "standard" goes back to the standard picture. A number in a headline or takeaway must already be in the notebook (read it with notebook-read), written as it is there. The picture is then at /notebooks/<id>/tldr.png on the dashboard.\n\nChoices:\n${tldrOptionsGuide()}`,
      inputSchema: {
        notebook: z.string().describe('The notebook: its id, a /notebooks/<id> link, or words from its title.'),
        action: z.enum(['show', 'draw', 'undo', 'standard']).optional().describe('What to do (default: draw when any field is given, else show).'),
        size: z.enum(keys(TLDR_SIZES)).optional(),
        tone: z.enum(keys(TLDR_TONES)).optional(),
        layout: z.enum(keys(TLDR_LAYOUTS)).optional(),
        parts: z.array(z.enum(keys(TLDR_PARTS))).optional().describe('Which parts, in the order to show them. Leave one out to drop it (e.g. no "stats").'),
        bars: z.number().int().optional().describe('How many bars, within the size\'s limit.'),
        headline: z.string().optional().describe('A headline over the notebook\'s title; "" removes it.'),
        takeaway: z.string().optional().describe('One line under the headline; "" removes it.'),
        ask: z.string().optional().describe('What the person asked for, in their words (shown where it\'s redrawn).'),
      },
    },
    async ({ notebook, action, size, tone, layout, parts, bars, headline, takeaway, ask }) => {
      if (!notebookStore) return errorResult('Notebooks are not available on this server.');
      const found = findNotebook(notebookStore, notebook);
      if (!found) return errorResult(`No notebook matches "${notebook}". List them with notebook-read.`);
      if ('matches' in found) return errorResult(`Several notebooks match "${notebook}": ${found.matches.slice(0, 8).map((n) => `${n.id} (${n.title})`).join(', ')}. Give its id.`);
      const nb = found.notebook;
      if (opts.dataRoot) {
        const d = evaluatePolicy(resolvePolicyDocument(opts.dataRoot), { toolId: 'notebook-tldr', resource: nb.id, agentSource: 'local', agentId: 'mcp' });
        if (d.effect === 'deny') return errorResult(d.reason ?? 'Policy denies "notebook-tldr".');
      }
      const where = `/notebooks/${encodeURIComponent(nb.id)}/tldr.png`;
      const given = [size, tone, layout, parts, bars, headline, takeaway].some((v) => v !== undefined);
      const act = action ?? (given ? 'draw' : 'show');
      if (act === 'show') {
        return { content: [{ type: 'text' as const, text: `"${nb.title}" is drawn as ${tldrLine(nb.tldr)}. ${String(notebookStore.tldrUndos(nb.id))} redraw(s) can be undone. Picture: ${where}\n\nYou can choose:\n${tldrOptionsGuide()}` }] };
      }
      if (act === 'undo') {
        const done = notebookStore.undoTldr(nb.id);
        const now = notebookStore.get(nb.id);
        return done
          ? { content: [{ type: 'text' as const, text: `Put back the picture from before: ${tldrLine(now?.tldr)}. Picture: ${where}` }] }
          : errorResult('Nothing to undo.');
      }
      if (act === 'standard') {
        notebookStore.setTldr(nb.id, null);
        return { content: [{ type: 'text' as const, text: `Back to the standard picture. Undo brings the redrawn one back. Picture: ${where}` }] };
      }
      // draw: what's given over how it's drawn now.
      const was: Partial<TldrSpec> = nb.tldr ?? {};
      const merged: Record<string, unknown> = { ...was, ...(size ? { size } : {}), ...(tone ? { tone } : {}), ...(layout ? { layout } : {}), ...(parts ? { parts } : {}), ...(bars !== undefined ? { bars } : {}), ask: ask ?? 'Redrawn from an MCP client', at: new Date().toISOString() };
      if (headline !== undefined) merged.headline = headline || undefined;
      if (takeaway !== undefined) merged.takeaway = takeaway || undefined;
      const spec = cleanTldrSpec(merged);
      if (!spec) return errorResult('That isn\'t a way to draw the picture.');
      // What the notebook says, without its timestamps: a note filed at 19:45 doesn't make "45%" one of its numbers.
      const known = `${nb.title} ${nb.statement} ${JSON.stringify(notebookReadoutJson(nb, notebookStore.entries(nb.id, 1000))).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, '')}`;
      const stray = strayTldrNumbers([spec.headline, spec.takeaway], known);
      if (stray.length) return errorResult(`Not redrawn: the headline or takeaway has ${stray.length === 1 ? 'a number' : 'numbers'} the notebook doesn't (${stray.join(', ')}). Use only numbers the notebook has, written as they are there (read it with notebook-read), or none.`);
      notebookStore.setTldr(nb.id, spec);
      return { content: [{ type: 'text' as const, text: `Redrawn "${nb.title}": ${tldrLine(spec)}. Undo puts back the one before. Picture: ${where} (add ?theme=dark for the dark one).` }] };
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
