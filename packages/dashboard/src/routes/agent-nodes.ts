import { Router, type Request, type Response } from 'express';
import type { Agent, AgentInputSpec } from '@some-useful-agents/core';
import { exportAgent, parseAgent, AgentYamlParseError } from '@some-useful-agents/core';
import { parse as parseRawYaml, stringify as stringifyRawYaml } from 'yaml';
import { html as h, render as renderHtml } from '../views/html.js';
import { layout } from '../views/layout.js';
import { pageHeader, deriveBack } from '../views/page-header.js';
import { renderAgentYaml } from '../views/agent-detail-v2.js';
import { getContext } from '../context.js';
import { renderAgentAddNode, type AddNodeFormValues } from '../views/agent-add-node.js';
import { renderAgentEditNode, type EditNodeFormValues } from '../views/agent-edit-node.js';
import { autoFixYaml } from './run-now-build.js';

export const agentNodesRouter: Router = Router();

const NODE_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

// ── Add node ────────────────────────────────────────────────────────────

agentNodesRouter.get('/agents/:name/add-node', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }
  const fromCreate = req.query.fromCreate === '1';
  const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  res.type('html').send(renderAgentAddNode({ agent, fromCreate, flash: flashParam, toolStore: ctx.toolStore, agentStore: ctx.agentStore, variablesStore: ctx.variablesStore }));
});

agentNodesRouter.post('/agents/:name/add-node', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawDeps = body.dependsOn;
  const dependsOn: string[] = Array.isArray(rawDeps)
    ? rawDeps.filter((d): d is string => typeof d === 'string')
    : typeof rawDeps === 'string' ? [rawDeps] : [];

  // Detect agent-invoke: tool field starts with "agent:" prefix.
  const rawTool = typeof body.tool === 'string' ? body.tool : '';
  const isAgentInvoke = rawTool.startsWith('agent:');
  const nodeType = body.type === 'agent-invoke' || isAgentInvoke
    ? 'agent-invoke'
    : body.type === 'claude-code' ? 'claude-code' : 'shell';

  const values: AddNodeFormValues = {
    id: typeof body.id === 'string' ? body.id.trim() : undefined,
    type: nodeType === 'agent-invoke' ? 'shell' : (nodeType as 'shell' | 'claude-code'), // form compat
    command: typeof body.command === 'string' ? body.command : undefined,
    prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
    dependsOn,
  };

  // Validate.
  if (!values.id || !NODE_ID_RE.test(values.id)) {
    res.status(400).type('html').send(renderAgentAddNode({
      agent, values, variablesStore: ctx.variablesStore, error: 'Node id must be lowercase letters, digits, hyphens, or underscores.',
    }));
    return;
  }
  if (agent.nodes.some((n) => n.id === values.id)) {
    res.status(400).type('html').send(renderAgentAddNode({
      agent, values, variablesStore: ctx.variablesStore, error: `A node with id "${values.id}" already exists in this agent.`,
    }));
    return;
  }
  // Every declared dependency must be a real node in this agent.
  const existingIds = new Set(agent.nodes.map((n) => n.id));
  const badDep = dependsOn.find((d) => !existingIds.has(d));
  if (badDep) {
    res.status(400).type('html').send(renderAgentAddNode({
      agent, values, variablesStore: ctx.variablesStore, error: `Unknown upstream node: "${badDep}".`,
    }));
    return;
  }

  // Type-specific validation.
  if (nodeType === 'agent-invoke') {
    const invokeAgentId = rawTool.replace(/^agent:/, '');
    if (!invokeAgentId || !ctx.agentStore.getAgent(invokeAgentId)) {
      res.status(400).type('html').send(renderAgentAddNode({
        agent, values, variablesStore: ctx.variablesStore, error: `Agent "${invokeAgentId}" not found.`,
      }));
      return;
    }
  } else if (nodeType === 'shell' && (!values.command || values.command.trim() === '')) {
    res.status(400).type('html').send(renderAgentAddNode({
      agent, values, variablesStore: ctx.variablesStore, error: 'Shell nodes need a command.',
    }));
    return;
  } else if (nodeType === 'claude-code' && (!values.prompt || values.prompt.trim() === '')) {
    res.status(400).type('html').send(renderAgentAddNode({
      agent, values, variablesStore: ctx.variablesStore, error: 'Claude-Code nodes need a prompt.',
    }));
    return;
  }

  // Build the new node.
  let newNode;
  if (nodeType === 'agent-invoke') {
    const invokeAgentId = rawTool.replace(/^agent:/, '');
    // Build inputMapping from toolInput_* form fields.
    const inputMapping: Record<string, string> = {};
    for (const [key, val] of Object.entries(body)) {
      if (typeof key === 'string' && key.startsWith('toolInput_') && typeof val === 'string' && val.trim()) {
        inputMapping[key.replace('toolInput_', '')] = val.trim();
      }
    }
    newNode = {
      id: values.id!,
      type: 'agent-invoke' as const,
      agentInvokeConfig: {
        agentId: invokeAgentId,
        ...(Object.keys(inputMapping).length > 0 ? { inputMapping } : {}),
      },
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
    };
  } else {
    newNode = nodeType === 'shell'
      ? { id: values.id!, type: 'shell' as const, command: values.command!, ...(dependsOn.length > 0 ? { dependsOn } : {}) }
      : { id: values.id!, type: 'claude-code' as const, prompt: values.prompt!, ...(dependsOn.length > 0 ? { dependsOn } : {}) };
  }

  try {
    ctx.agentStore.upsertAgent(
      { ...agent, nodes: [...agent.nodes, newNode] },
      'dashboard',
      `Added node "${values.id}" via dashboard`,
    );
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/add-node?flash=${encodeURIComponent(`Added "${values.id}". Add another or click Done.`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).type('html').send(renderAgentAddNode({
      agent, values, variablesStore: ctx.variablesStore, error: `Save failed: ${msg}`,
    }));
  }
});

// ── Edit node ───────────────────────────────────────────────────────────

agentNodesRouter.get('/agents/:name/nodes/:nodeId/edit', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const nodeId = Array.isArray(req.params.nodeId) ? req.params.nodeId[0] : req.params.nodeId;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }
  const node = agent.nodes.find((n) => n.id === nodeId);
  if (!node) {
    res.status(404).redirect(303, `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent(`Node "${nodeId}" not found.`)}`);
    return;
  }
  res.type('html').send(renderAgentEditNode({ agent, node, toolStore: ctx.toolStore, variablesStore: ctx.variablesStore }));
});

agentNodesRouter.post('/agents/:name/nodes/:nodeId/edit', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const nodeId = Array.isArray(req.params.nodeId) ? req.params.nodeId[0] : req.params.nodeId;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }
  const node = agent.nodes.find((n) => n.id === nodeId);
  if (!node) {
    res.status(404).redirect(303, `/agents/${encodeURIComponent(agent.id)}`);
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawDeps = body.dependsOn;
  const dependsOn: string[] = Array.isArray(rawDeps)
    ? rawDeps.filter((d): d is string => typeof d === 'string')
    : typeof rawDeps === 'string' ? [rawDeps] : [];

  const values: EditNodeFormValues = {
    type: body.type === 'claude-code' ? 'claude-code' : 'shell',
    command: typeof body.command === 'string' ? body.command : undefined,
    prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
    dependsOn,
  };

  // Every declared dependency must be a node that's not the current
  // node itself, not a downstream (cycle), and exists.
  const existingIds = new Set(agent.nodes.map((n) => n.id));
  if (dependsOn.includes(nodeId)) {
    res.status(400).type('html').send(renderAgentEditNode({
      agent, node, values, variablesStore: ctx.variablesStore, error: 'A node cannot depend on itself.',
    }));
    return;
  }
  const badDep = dependsOn.find((d) => !existingIds.has(d));
  if (badDep) {
    res.status(400).type('html').send(renderAgentEditNode({
      agent, node, values, variablesStore: ctx.variablesStore, error: `Unknown upstream node: "${badDep}".`,
    }));
    return;
  }
  // Cycle guard: the view already filters downstreams from the picker,
  // but a hand-crafted POST could bypass it. Re-check.
  if (hasCycleAfterEdit(agent, nodeId, dependsOn)) {
    res.status(400).type('html').send(renderAgentEditNode({
      agent, node, values, variablesStore: ctx.variablesStore, error: 'Those dependencies would create a cycle in the DAG.',
    }));
    return;
  }
  if (values.type === 'shell' && (!values.command || values.command.trim() === '')) {
    res.status(400).type('html').send(renderAgentEditNode({
      agent, node, values, variablesStore: ctx.variablesStore, error: 'Shell nodes need a command.',
    }));
    return;
  }
  if (values.type === 'claude-code' && (!values.prompt || values.prompt.trim() === '')) {
    res.status(400).type('html').send(renderAgentEditNode({
      agent, node, values, variablesStore: ctx.variablesStore, error: 'Claude-Code nodes need a prompt.',
    }));
    return;
  }

  // Build the updated node. Preserve any fields we don't let the form
  // edit (inputs, secrets, env, envAllowlist, allowedTools, model,
  // maxTurns, timeout, redactSecrets, position) — those come back in
  // a follow-up when the inspector can render them.
  const provider = typeof body.provider === 'string' && ['claude', 'codex'].includes(body.provider)
    ? body.provider as 'claude' | 'codex'
    : undefined;

  const updatedNode = values.type === 'shell'
    ? { ...node, type: 'shell' as const, command: values.command!, prompt: undefined, provider: undefined, ...(dependsOn.length > 0 ? { dependsOn } : { dependsOn: undefined }) }
    : { ...node, type: 'claude-code' as const, prompt: values.prompt!, command: undefined, ...(provider ? { provider } : {}), ...(dependsOn.length > 0 ? { dependsOn } : { dependsOn: undefined }) };

  const updatedNodes = agent.nodes.map((n) => n.id === nodeId ? updatedNode : n);

  try {
    ctx.agentStore.createNewVersion(
      agent.id,
      { ...agent, nodes: updatedNodes, inputs: mergeNewInput(agent.inputs, body) },
      'dashboard',
      `Edited node "${nodeId}"`,
    );
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent(`Updated "${nodeId}". New version created.`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).type('html').send(renderAgentEditNode({
      agent, node, values, variablesStore: ctx.variablesStore, error: `Save failed: ${msg}`,
    }));
  }
});

// ── Delete node ─────────────────────────────────────────────────────────

agentNodesRouter.post('/agents/:name/nodes/:nodeId/delete', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const nodeId = Array.isArray(req.params.nodeId) ? req.params.nodeId[0] : req.params.nodeId;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }
  if (!agent.nodes.some((n) => n.id === nodeId)) {
    res.status(404).redirect(303, `/agents/${encodeURIComponent(agent.id)}`);
    return;
  }

  // Refuse if anyone depends on this node. Explicit is better than
  // auto-trimming dependsOn — user may be surprised to discover their
  // downstream node silently lost an input.
  const dependents = agent.nodes.filter((n) => n.dependsOn?.includes(nodeId));
  if (dependents.length > 0) {
    const names = dependents.map((n) => `"${n.id}"`).join(', ');
    const msg = `Cannot delete "${nodeId}" \u2014 ${names} depend${dependents.length === 1 ? 's' : ''} on it. Delete or edit ${dependents.length === 1 ? 'it' : 'them'} first.`;
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent(msg)}`);
    return;
  }

  if (agent.nodes.length === 1) {
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent('Cannot delete the last node. Delete the agent itself from the CLI if you want to remove it entirely.')}`);
    return;
  }

  const updatedNodes = agent.nodes.filter((n) => n.id !== nodeId);
  try {
    ctx.agentStore.createNewVersion(
      agent.id,
      { ...agent, nodes: updatedNodes },
      'dashboard',
      `Deleted node "${nodeId}"`,
    );
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent(`Deleted "${nodeId}". New version created.`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent(`Delete failed: ${msg}`)}`);
  }
});

// ── Raw YAML editor ─────────────────────────────────────────────────────

agentNodesRouter.get('/agents/:name/yaml', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  const yaml = exportAgent(agent);
  const error = typeof req.query.error === 'string' ? req.query.error : undefined;

  const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const fromParam = typeof req.query.from === 'string' ? req.query.from : undefined;
  const referer = typeof req.headers.referer === 'string' ? req.headers.referer : undefined;
  const back = deriveBack(referer, `127.0.0.1:${ctx.port}`, fromParam);

  res.type('html').send(renderAgentYaml({
    agent,
    recentRuns: [],
    secretsStore: ctx.secretsStore,
    activeTab: 'yaml',
    flash: flashParam ? { kind: 'ok' as const, message: flashParam } : undefined,
    back,
    from: fromParam,
    yaml,
    error,
  }));
});

agentNodesRouter.post('/agents/:name/yaml', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  // "Edit suggested YAML first" / "Review + apply" — render the editor
  // pre-filled with the suggested YAML instead of saving.
  if (typeof body.prefillYaml === 'string' && !body.yaml) {
    const prefilled = body.prefillYaml as string;
    const editorBody = h`
      ${pageHeader({
        title: `Edit YAML \u2014 ${agent.id}`,
        back: { href: `/agents/${agent.id}`, label: `Back to ${agent.id}` },
        description: `Editing AI-suggested YAML. Review and save to create a new version.`,
      })}
      <form method="POST" action="/agents/${agent.id}/yaml" class="card" style="max-width: 800px;">
        <label style="display: flex; flex-direction: column; gap: var(--space-2);">
          <textarea name="yaml" rows="30" required
            style="padding: var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--font-size-xs); resize: vertical; line-height: 1.5; tab-size: 2;">${prefilled}</textarea>
        </label>
        <div style="margin-top: var(--space-3); display: flex; gap: var(--space-2); justify-content: flex-end;">
          <a class="btn btn--ghost" href="/agents/${agent.id}">Cancel</a>
          <button type="submit" class="btn btn--primary">Save YAML</button>
        </div>
      </form>
    `;
    res.type('html').send(renderHtml(layout({ title: `Edit YAML \u2014 ${agent.id}`, activeNav: 'agents' }, editorBody)));
    return;
  }

  let yamlText = typeof body.yaml === 'string' ? body.yaml : '';

  // Run the full autoFixYaml pipeline so hand-edits and pasted YAML get
  // the same rescues that AI-suggested YAML gets (un-escape `{ {`,
  // shorthand outputs, signal/template normalisation, etc.). Keeps a
  // single source of truth for "what we silently fix on save".
  yamlText = autoFixYaml(yamlText);

  // Additional save-path-only fix: {{inputs.X}} in shell commands → $X.
  // Shell nodes use env vars, not template syntax. The autoFixYaml
  // pipeline doesn't include this because it'd break legitimate
  // {{inputs.X}} usage in claude-code prompts.
  try {
    const raw = parseRawYaml(yamlText);
    if (raw?.nodes && Array.isArray(raw.nodes)) {
      let changed = false;
      for (const node of raw.nodes) {
        if (node.type === 'shell' && typeof node.command === 'string') {
          const fixed = node.command.replace(
            /\{\{inputs\.([A-Z_][A-Z0-9_]*)\}\}/g,
            (_: string, name: string) => '$' + name,
          );
          if (fixed !== node.command) { node.command = fixed; changed = true; }
        }
      }
      if (changed) yamlText = stringifyRawYaml(raw, { lineWidth: 0 });
    }
  } catch { /* if raw parse fails, let the real parser report the error */ }

  let parsed: Agent;
  try {
    parsed = parseAgent(yamlText);
  } catch (err) {
    const msg = err instanceof AgentYamlParseError
      ? err.message
      : `Parse error: ${(err as Error).message}`;
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/yaml?error=${encodeURIComponent(msg)}`);
    return;
  }

  // Ensure the id matches — don't let YAML edits rename the agent.
  if (parsed.id !== agent.id) {
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/yaml?error=${encodeURIComponent(`Agent id in YAML ("${parsed.id}") must match the current agent id ("${agent.id}"). Renaming via YAML is not supported.`)}`);
    return;
  }

  try {
    ctx.agentStore.createNewVersion(
      agent.id,
      {
        ...parsed,
        // Preserve source — don't let YAML override trust level.
        source: agent.source,
      },
      'dashboard',
      'Updated via YAML editor',
    );
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent('Saved from YAML. New version created.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/yaml?error=${encodeURIComponent(`Save failed: ${msg}`)}`);
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Cycle guard used by the edit route. Simulates the edit and walks the
 * DAG from each root — if we revisit a node, the graph has a cycle.
 */
function hasCycleAfterEdit(agent: Agent, editedNodeId: string, newDependsOn: string[]): boolean {
  const depsByNode = new Map<string, string[]>();
  for (const n of agent.nodes) {
    depsByNode.set(n.id, n.id === editedNodeId ? newDependsOn : (n.dependsOn ?? []));
  }
  const white = new Set(depsByNode.keys());
  const gray = new Set<string>();
  const black = new Set<string>();
  function visit(id: string): boolean {
    if (black.has(id)) return false;
    if (gray.has(id)) return true;
    gray.add(id);
    white.delete(id);
    for (const d of depsByNode.get(id) ?? []) {
      if (visit(d)) return true;
    }
    gray.delete(id);
    black.add(id);
    return false;
  }
  for (const id of [...white]) {
    if (visit(id)) return true;
  }
  return false;
}

/**
 * Merge a new agent input from the "Add variable" form on the edit-node
 * page. If `newInputName` is present in the body and valid, adds it to
 * the existing inputs map. Returns the merged inputs (or the original
 * if no new input was provided).
 */
export function mergeNewInput(
  existing: Record<string, AgentInputSpec> | undefined,
  body: Record<string, unknown>,
): Record<string, AgentInputSpec> | undefined {
  const name = typeof body.newInputName === 'string' ? body.newInputName.trim() : '';
  if (!name || !/^[A-Z_][A-Z0-9_]*$/.test(name)) return existing;

  const type = typeof body.newInputType === 'string' && ['string', 'number', 'boolean', 'enum'].includes(body.newInputType)
    ? body.newInputType as 'string' | 'number' | 'boolean' | 'enum'
    : 'string';

  const rawDefault = typeof body.newInputDefault === 'string' ? body.newInputDefault.trim() : '';
  const description = typeof body.newInputDescription === 'string' ? body.newInputDescription.trim() : '';
  const rawValues = typeof body.newInputValues === 'string' ? body.newInputValues : '';

  const spec: AgentInputSpec = { type };
  if (rawDefault) {
    if (type === 'number') spec.default = Number(rawDefault);
    else if (type === 'boolean') spec.default = rawDefault === 'true';
    else spec.default = rawDefault;
  }
  if (description) spec.description = description;
  if (type === 'enum') {
    const values = parseEnumValues(rawValues);
    if (values.length === 0) return existing; // enum without values is invalid — skip creation
    (spec as AgentInputSpec & { values: string[] }).values = values;
  }

  return { ...(existing ?? {}), [name]: spec };
}

/**
 * Parse an enum values input (comma-separated, or JSON array).
 * Trims, drops blanks, dedupes while preserving order.
 */
export function parseEnumValues(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let candidates: string[] = [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) candidates = parsed.map((v) => String(v));
    } catch {
      // fall through to comma split
    }
  }
  if (candidates.length === 0) {
    candidates = trimmed.split(',').map((s) => s.trim());
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of candidates) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
