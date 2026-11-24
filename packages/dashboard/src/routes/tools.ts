import { Router, type Request, type Response } from 'express';
import {
  listBuiltinTools,
  getBuiltinTool,
  listMcpTools,
  parseMcpServersBlob,
  toolDefinitionSchema,
  checkUserToolYaml,
  saveUserTool,
  removeUserTool,
  agentsUsingTool,
  isUserRunTool,
  UserToolError,
  executeAgentDag,
  isAppleIntegrationEnabled,
  type Agent,
  type McpServerConfig,
} from '@some-useful-agents/core';
import { randomUUID } from 'node:crypto';
import { renderToolForm } from '../views/tool-form.js';
import { buildLlmSettingsSnapshot } from '../lib/llm-settings-snapshot.js';
import {
  EMPTY_TOOL_FORM,
  toolFormFromBody,
  toolFormToYaml,
  toolFormFromTool,
  toolFormFromYaml,
  parseSampleInputs,
  type ToolFormValues,
} from '../lib/tool-form.js';
import { getContext } from '../context.js';
import { buildMcpServersPanel, buildIntegrationsPanel } from './settings.js';
import { computeProviderUsage } from '../lib/provider-usage.js';
import { renderToolsList } from '../views/tools-list.js';
import { renderToolDetail } from '../views/tool-detail.js';
import {
  renderMcpImport,
  renderMcpImportResult,
  type DiscoveredServer,
  type DiscoveredTool,
} from '../views/tool-mcp-import.js';
import type { ToolDefinition, ToolImplementation } from '@some-useful-agents/core';

export const toolsRouter: Router = Router();

toolsRouter.get('/tools', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const builtins = listBuiltinTools();
  let userTools: ToolDefinition[] = [];
  try {
    if (ctx.toolStore) {
      userTools = ctx.toolStore.listTools();
    }
  } catch {
    // Store not available — show builtins only.
  }
  const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;
  const type = typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined;
  const rawTab = typeof req.query.tab === 'string' ? req.query.tab : '';
  const tab: 'user' | 'builtin' | 'servers' | 'integrations' =
    rawTab === 'builtin' || rawTab === 'servers' || rawTab === 'integrations' ? rawTab : 'user';
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 12));
  const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);

  // LLM providers section: derived view of which CLIs are on PATH and
  // how many agents use each one. Not invocable — pure discoverability.
  let providerUsage: ReturnType<typeof computeProviderUsage> = [];
  try {
    providerUsage = computeProviderUsage(ctx.agentStore.listAgents());
  } catch {
    // Agent store unavailable — show providers without usage counts.
    providerUsage = computeProviderUsage([]);
  }

  // Servers and Integrations moved here from Settings (ADR-0034). Both panels
  // are always costed for their tab counts — two direct SQLite scans we
  // already do elsewhere — so the strip shows real numbers on every tab.
  const setError = typeof req.query.setError === 'string' ? req.query.setError : undefined;
  // Server toggle/delete and integration add/delete redirect back here with a
  // banner; without this they would post and appear to do nothing.
  const flashMsg = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const errorMsg = typeof req.query.error === 'string' ? req.query.error : undefined;
  const flash = errorMsg
    ? { kind: 'error' as const, message: errorMsg }
    : flashMsg
      ? { kind: 'ok' as const, message: flashMsg }
      : undefined;
  const servers = buildMcpServersPanel(ctx, setError);
  const connections = buildIntegrationsPanel(ctx, req);
  const panel = tab === 'servers' ? servers.body : tab === 'integrations' ? connections.body : undefined;

  res.type('html').send(renderToolsList({
    builtins,
    userTools,
    filter: { q, type },
    tab,
    limit,
    offset,
    providerUsage,
    panel,
    serverCount: servers.count,
    integrationCount: connections.count,
    flash,
  }));
});

toolsRouter.get('/tools/mcp/import', (_req: Request, res: Response) => {
  res.type('html').send(renderMcpImport({}));
});

toolsRouter.post('/tools/mcp/import', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = req.body as Record<string, string | string[]>;
  const step = body.step === 'create' ? 'create' : 'discover';
  const rawBlob = typeof body.configBlob === 'string' ? body.configBlob : '';
  const quickUrl = typeof body.quickUrl === 'string' ? body.quickUrl.trim() : '';
  const quickName = typeof body.quickName === 'string' ? body.quickName.trim() : '';

  // Quick-add synthesises a one-entry blob so the rest of the pipeline stays identical.
  let configBlob = rawBlob;
  if (!configBlob.trim() && quickUrl) {
    const name = quickName || deriveNameFromUrl(quickUrl);
    configBlob = JSON.stringify({ [name]: { url: quickUrl } });
  }

  if (!configBlob.trim()) {
    res.status(400).type('html').send(renderMcpImport({
      configBlob: rawBlob,
      quickUrl,
      quickName,
      error: 'Enter a URL for quick-add, or paste a config.',
    }));
    return;
  }

  const { servers: parsedServers, errors: parseErrors } = parseMcpServersBlob(configBlob);
  if (parsedServers.length === 0) {
    res.status(400).type('html').send(renderMcpImport({
      configBlob: rawBlob,
      quickUrl,
      quickName,
      parseErrors,
      error: 'No valid MCP servers found in the config.',
    }));
    return;
  }

  // Shared context for both steps.
  const existingIds = new Set<string>();
  const existingServerIds = new Set<string>();
  if (ctx.toolStore) {
    for (const t of ctx.toolStore.listTools()) existingIds.add(t.id);
    for (const s of ctx.toolStore.listMcpServers()) existingServerIds.add(s.id);
  }

  // Discovery: connect to every parsed server in parallel, collect tools.
  const discovered: DiscoveredServer[] = await Promise.all(
    parsedServers.map(async (server) => {
      try {
        const tools = await listMcpTools(serverToImpl(server));
        return { server, tools: tools.map(toDiscoveredTool) };
      } catch (err) {
        return { server, tools: [], error: (err as Error).message };
      }
    }),
  );

  if (step === 'discover') {
    res.type('html').send(renderMcpImport({
      configBlob,
      quickUrl,
      quickName,
      parseErrors,
      servers: discovered,
      existingIds,
      existingServerIds,
    }));
    return;
  }

  // step === 'create'
  if (!ctx.toolStore) {
    res.status(500).type('html').send(renderMcpImport({
      configBlob,
      quickUrl,
      quickName,
      parseErrors,
      servers: discovered,
      existingIds,
      existingServerIds,
      error: 'Tool store unavailable.',
    }));
    return;
  }

  const selectedRaw = body.select;
  const selected: string[] = Array.isArray(selectedRaw) ? selectedRaw : selectedRaw ? [selectedRaw] : [];
  if (selected.length === 0) {
    res.redirect(303, '/tools');
    return;
  }

  // Group selections by server id: value format is "<serverId>|<remoteToolName>".
  const byServer = new Map<string, string[]>();
  for (const pair of selected) {
    const idx = pair.indexOf('|');
    if (idx <= 0) continue;
    const serverId = pair.slice(0, idx);
    const toolName = pair.slice(idx + 1);
    if (!byServer.has(serverId)) byServer.set(serverId, []);
    byServer.get(serverId)!.push(toolName);
  }

  const created: ToolDefinition[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const serversCreated: string[] = [];

  for (const [serverId, toolNames] of byServer) {
    const ds = discovered.find((d) => d.server.id === serverId);
    if (!ds) {
      for (const name of toolNames) skipped.push({ name: `${serverId}/${name}`, reason: 'server not in discovery result' });
      continue;
    }
    if (ds.error) {
      for (const name of toolNames) skipped.push({ name: `${serverId}/${name}`, reason: `server connect error: ${ds.error}` });
      continue;
    }

    // Upsert the server row (once per server).
    ctx.toolStore.upsertMcpServer(ds.server);
    if (!existingServerIds.has(serverId)) serversCreated.push(serverId);

    const implBase = serverToImpl(ds.server);
    const discoveredByName = new Map(ds.tools.map((t) => [t.name, t]));
    for (const remoteName of toolNames) {
      const remote = discoveredByName.get(remoteName);
      if (!remote) {
        skipped.push({ name: `${serverId}/${remoteName}`, reason: 'not found on server' });
        continue;
      }
      const localId = `${serverId}-${slugify(remote.name)}`;
      if (ctx.toolStore.getTool(localId)) {
        skipped.push({ name: `${serverId}/${remoteName}`, reason: `local id "${localId}" already exists` });
        continue;
      }
      const draft: ToolDefinition = {
        id: localId,
        name: remote.name,
        description: remote.description,
        source: 'local',
        inputs: mapJsonSchemaToInputs(remote.inputSchema),
        outputs: {},
        implementation: { ...implBase, mcpToolName: remote.name },
      };
      const parsed = toolDefinitionSchema.safeParse(draft);
      if (!parsed.success) {
        skipped.push({ name: `${serverId}/${remoteName}`, reason: parsed.error.issues[0]?.message ?? 'schema error' });
        continue;
      }
      const saved = ctx.toolStore.createTool(draft, undefined, serverId);
      created.push(saved);
    }
  }

  res.type('html').send(renderMcpImportResult({ created, skipped, serversCreated }));
});

// --- Tools you add: New tool, Edit, Remove, Try it (docs/tools.md) ---

/** What the posted form describes: its fields, the YAML to save, and which view it was in. */
function postedTool(body: Record<string, unknown>): { values: ToolFormValues; yaml: string; view: 'fields' | 'yaml'; error?: string } {
  const view = body.view === 'yaml' ? 'yaml' : 'fields';
  if (view === 'yaml') {
    const yaml = typeof body.yaml === 'string' ? body.yaml.replace(/\r\n/g, '\n') : '';
    const parsed = toolFormFromYaml(yaml);
    if ('error' in parsed) return { values: EMPTY_TOOL_FORM, yaml, view, error: parsed.error };
    return { values: parsed, yaml, view };
  }
  const values = toolFormFromBody(body);
  return { values, yaml: toolFormToYaml(values), view };
}

function handleToolForm(req: Request, res: Response, mode: 'new' | 'edit', editId?: string): void {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : 'save';
  const sample = typeof body.sample === 'string' ? body.sample : undefined;
  const posted = postedTool(body);
  const page = (extra: Partial<Parameters<typeof renderToolForm>[0]>) =>
    res.type('html').send(renderToolForm({ mode, values: posted.values, view: posted.view, yaml: posted.yaml, sample, ...extra }));

  // Switching between the fields and the YAML keeps what you wrote.
  if (action === 'to_yaml') { page({ view: 'yaml', yaml: toolFormToYaml(posted.values) }); return; }
  if (action === 'to_fields') {
    if (posted.error) { page({ errors: [posted.error] }); return; }
    page({ view: 'fields' });
    return;
  }
  if (posted.error) { page({ errors: [posted.error] }); return; }
  if (!ctx.toolStore) { page({ errors: ["The tool store isn't available here."] }); return; }
  if (mode === 'edit' && posted.values.id !== editId) {
    page({ errors: [`A tool's id can't change here (it's "${editId}"). Save a new tool instead.`] });
    return;
  }
  if (mode === 'new' && ctx.toolStore.getTool(posted.values.id)) {
    page({ errors: [`There's already a tool "${posted.values.id}". Choose another id, or edit that one.`] });
    return;
  }
  const checked = checkUserToolYaml(posted.yaml, ctx.toolStore);
  if (!checked.tool) { page({ errors: checked.errors }); return; }
  if (checked.warnings.length && action !== 'save_anyway') { page({ warnings: checked.warnings }); return; }
  try {
    const { tool, created } = saveUserTool(ctx.toolStore, posted.yaml);
    res.redirect(303, `/tools/${encodeURIComponent(tool.id)}?flash=${encodeURIComponent(created ? 'Saved. Use it in a step with tool: ' + tool.id + '.' : 'Saved your changes.')}`);
  } catch (err) {
    page({ errors: err instanceof UserToolError ? err.errors : [(err as Error).message] });
  }
}

toolsRouter.get('/tools/new', (_req: Request, res: Response) => {
  res.type('html').send(renderToolForm({ mode: 'new', values: EMPTY_TOOL_FORM, view: 'fields' }));
});

toolsRouter.post('/tools/new', (req: Request, res: Response) => handleToolForm(req, res, 'new'));

/** A trial gets two minutes (a prompt tool waits on a model). */
const TOOL_TRIAL_MS = 120_000;
const TOOL_TRIAL_RESULT_CHARS = 4000;

/**
 * POST /tools/try (the form's fields) → { ok, runId } or { ok: false, errors }.
 * Runs the unsaved tool once as a one-step trial run, with the sample inputs.
 */
toolsRouter.post('/tools/try', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const posted = postedTool(body);
  if (posted.error) { res.json({ ok: false, errors: [posted.error] }); return; }
  const checked = checkUserToolYaml(posted.yaml, ctx.toolStore);
  if (!checked.tool) { res.json({ ok: false, errors: checked.errors }); return; }
  const sample = parseSampleInputs(typeof body.sample === 'string' ? body.sample : '');
  if ('error' in sample) { res.json({ ok: false, errors: [sample.error] }); return; }
  const tool = checked.tool;
  const isPrompt = tool.implementation.type !== 'shell';
  const agent: Agent = {
    id: `try-${tool.id}`,
    name: `Try ${tool.name}`,
    status: 'active',
    source: 'local',
    mcp: false,
    version: 1,
    nodes: [{ id: 'try', type: isPrompt ? 'llm-prompt' : 'shell', tool: tool.id, toolInputs: sample, ...(isPrompt ? { prompt: tool.implementation.prompt } : {}) }],
  };
  const runId = randomUUID();
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TOOL_TRIAL_MS);
  ctx.activeRuns.set(runId, abortController);
  executeAgentDag(
    agent,
    { triggeredBy: 'trial', signal: abortController.signal, runId, suppressNotify: true },
    {
      runStore: ctx.runStore,
      secretsStore: ctx.secretsStore,
      variablesStore: ctx.variablesStore,
      integrationsStore: ctx.integrationsStore,
      toolStore: ctx.toolStore,
      draftTools: { [tool.id]: tool },
      agentStore: ctx.agentStore,
      allowUntrustedShell: ctx.allowUntrustedShell,
      dataRoot: ctx.agentStore.dataRoot,
      llmSettings: buildLlmSettingsSnapshot(ctx),
      spawnNode: ctx.workflowSpawnNode,
      experimentalApple: isAppleIntegrationEnabled(),
    },
  )
    .catch(() => { /* surfaced on the run row */ })
    .finally(() => { clearTimeout(timer); ctx.activeRuns.delete(runId); });
  res.json({ ok: true, runId });
});

/** GET /tools/try/:runId → the trial's status and, when done, what the tool gave back. */
toolsRouter.get('/tools/try/:runId', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const runId = String(req.params.runId);
  const run = ctx.runStore.getRun(runId);
  if (!run || run.triggeredBy !== 'trial') { res.status(404).json({ ok: false, error: 'No such trial.' }); return; }
  const done = run.status !== 'running' && run.status !== 'pending';
  if (!done) { res.json({ ok: true, done: false }); return; }
  const node = ctx.runStore.listNodeExecutions(runId).find((n) => n.nodeId === 'try');
  let outputs: Record<string, unknown> | undefined;
  try {
    const parsed = node?.outputsJson ? JSON.parse(node.outputsJson) as Record<string, unknown> : undefined;
    if (parsed) { const { result: _r, ...rest } = parsed; outputs = rest; }
  } catch { /* not JSON */ }
  const result = node?.result ?? run.result ?? '';
  res.json({
    ok: true,
    done: true,
    status: run.status,
    url: `/runs/${runId}`,
    result: result.length > TOOL_TRIAL_RESULT_CHARS ? `${result.slice(0, TOOL_TRIAL_RESULT_CHARS)}…` : result,
    outputs,
    exitCode: node?.exitCode,
    error: node?.error ?? run.error,
    durationMs: run.completedAt ? Date.parse(run.completedAt) - Date.parse(run.startedAt) : undefined,
  });
});

toolsRouter.get('/tools/:id/edit', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  const tool = ctx.toolStore?.getTool(id);
  if (!tool || !isUserRunTool(tool) || ctx.toolStore?.getToolServerId(id)) { res.redirect(303, `/tools/${encodeURIComponent(id)}`); return; }
  res.type('html').send(renderToolForm({ mode: 'edit', values: toolFormFromTool(tool), view: 'fields' }));
});

toolsRouter.post('/tools/:id/edit', (req: Request, res: Response) => handleToolForm(req, res, 'edit', String(req.params.id)));

toolsRouter.post('/tools/:id/remove', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  try {
    if (!ctx.toolStore) throw new UserToolError(["The tool store isn't available here."]);
    removeUserTool(ctx.toolStore, id);
    res.redirect(303, `/tools?flash=${encodeURIComponent(`Removed ${id}.`)}`);
  } catch (err) {
    res.redirect(303, `/tools/${encodeURIComponent(id)}?error=${encodeURIComponent(err instanceof UserToolError ? err.message : (err as Error).message)}`);
  }
});

toolsRouter.get('/tools/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  // Find every agent that statically references this tool. Sourced from
  // the parse-time `capabilities.tools_used` (covers explicit `tool:`,
  // type-based desugaring, and node-level `allowedTools`). Cheap enough
  // to walk all agents on each request — there's no high-cardinality
  // workload that would warrant an index.
  const usedByAgents = (() => {
    try {
      const agents = ctx.agentStore.listAgents();
      // A step's tool:, and (for a tool a model may call) a step's tools: list.
      const viaTools = new Set(agentsUsingTool(agents, id));
      return agents
        .filter((a) => a.capabilities?.tools_used.includes(id) || viaTools.has(a.id))
        .map((a) => ({ id: a.id, name: a.name, status: a.status }));
    } catch {
      return [];
    }
  })();

  const builtin = getBuiltinTool(id);
  if (builtin) {
    res.type('html').send(renderToolDetail({ tool: builtin.definition, usedByAgents }));
    return;
  }

  try {
    if (ctx.toolStore) {
      const tool = ctx.toolStore.getTool(id);
      if (tool) {
        const serverId = ctx.toolStore.getToolServerId(id);
        const flash = typeof req.query.error === 'string'
          ? { kind: 'error' as const, message: req.query.error }
          : typeof req.query.flash === 'string' ? { kind: 'ok' as const, message: req.query.flash } : undefined;
        res.type('html').send(renderToolDetail({ tool, mcpServerId: serverId, usedByAgents, editable: !serverId && isUserRunTool(tool), flash }));
        return;
      }
    }
  } catch {
    // Store unavailable.
  }

  res.status(404).redirect(303, '/tools');
});

// --- helpers ---

function serverToImpl(server: McpServerConfig): ToolImplementation {
  return {
    type: 'mcp',
    mcpTransport: server.transport,
    mcpCommand: server.command,
    mcpArgs: server.args,
    mcpEnv: server.env,
    mcpUrl: server.url,
    mcpToolName: '',
  };
}

function toDiscoveredTool(t: { name: string; description?: string; inputSchema?: unknown }): DiscoveredTool {
  return { name: t.name, description: t.description, inputSchema: t.inputSchema };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function deriveNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname === '127.0.0.1' || u.hostname === 'localhost' ? 'mcp' : u.hostname;
    const slug = slugify(`${host}-${u.port || '80'}`);
    return slug || 'mcp-server';
  } catch {
    return 'mcp-server';
  }
}

type InputShape = Record<string, { type: 'string' | 'number' | 'boolean' | 'json' | 'object' | 'array'; description?: string; required?: boolean }>;

function mapJsonSchemaToInputs(schema: unknown): InputShape {
  if (!schema || typeof schema !== 'object') return {};
  const s = schema as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
  const required = new Set(s.required ?? []);
  const out: InputShape = {};
  for (const [name, prop] of Object.entries(s.properties ?? {})) {
    const t = prop?.type;
    const mapped: InputShape[string]['type'] =
      t === 'number' || t === 'integer' ? 'number' :
      t === 'boolean' ? 'boolean' :
      t === 'object' ? 'object' :
      t === 'array' ? 'array' :
      'string';
    out[name] = {
      type: mapped,
      description: prop?.description,
      required: required.has(name),
    };
  }
  return out;
}
