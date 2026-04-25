import { Router, type Request, type Response } from 'express';
import {
  listBuiltinTools,
  getBuiltinTool,
  listMcpTools,
  parseMcpServersBlob,
  toolDefinitionSchema,
  type McpServerConfig,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
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
  const tab = req.query.tab === 'builtin' ? 'builtin' : 'user';
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 12));
  const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);
  res.type('html').send(renderToolsList({ builtins, userTools, filter: { q, type }, tab, limit, offset }));
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

toolsRouter.get('/tools/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const builtin = getBuiltinTool(id);
  if (builtin) {
    res.type('html').send(renderToolDetail({ tool: builtin.definition }));
    return;
  }

  try {
    if (ctx.toolStore) {
      const tool = ctx.toolStore.getTool(id);
      if (tool) {
        const serverId = ctx.toolStore.getToolServerId(id);
        res.type('html').send(renderToolDetail({ tool, mcpServerId: serverId }));
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
