/**
 * Agent analyze + build routes. Extracted from run-now.ts.
 *
 * Analyze: POST/GET /agents/:name/analyze — suggest improvements modal.
 * Build: POST /agents/build, GET /agents/build/:runId, POST /agents/build/create.
 */

import { Router, type Request, type Response } from 'express';
import { executeAgentDag, exportAgent, listBuiltinTools, parseAgent, buildDiscoveryCatalog, type RunStatus, type ToolDefinition } from '@some-useful-agents/core';
import { TEMPLATE_REGISTRY } from '../views/pulse-templates.js';
import { parse as parseRawYaml, stringify as stringifyRawYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getContext } from '../context.js';

export const buildRouter: Router = Router();

const ANALYZER_AGENT_ID = 'agent-analyzer';
const BUILDER_AGENT_ID = 'agent-builder';

/**
 * Format a list of tool definitions into a human-readable catalog string
 * for injection into the builder agent prompt.
 */
function formatToolCatalog(tools: ToolDefinition[]): string {
  return tools
    .map((t) => {
      const inputNames = Object.keys(t.inputs ?? {}).join(', ');
      const desc = t.description ? t.description.replace(/\n/g, ' ').trim() : '';
      const implType = t.implementation?.type ?? 'builtin';
      return `- ${t.id} (type: ${implType}): ${desc}${inputNames ? ` Inputs: ${inputNames}.` : ''}`;
    })
    .join('\n');
}

// ── Analyze (suggest improvements) ──────────────────────────────────────

/**
 * POST /agents/:name/analyze — run the agent-analyzer with the target
 * agent's YAML as input. Returns JSON so the client can render results
 * in a modal without navigating away.
 */
buildRouter.post('/agents/:name/analyze', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;

  const target = ctx.agentStore.getAgent(name);
  if (!target) {
    res.json({ ok: false, error: 'Agent not found.' });
    return;
  }

  // Auto-import or update the analyzer agent from examples YAML.
  let analyzer: ReturnType<typeof ctx.agentStore.getAgent> = null;
  try {
    const yamlPath = join(resolve('agents/examples'), `${ANALYZER_AGENT_ID}.yaml`);
    const yamlText = readFileSync(yamlPath, 'utf-8');
    const parsed = parseAgent(yamlText);
    ctx.agentStore.upsertAgent(parsed, 'import', 'Auto-imported for suggest improvements');
    analyzer = ctx.agentStore.getAgent(ANALYZER_AGENT_ID);
  } catch { /* fall through */ }
  if (!analyzer) {
    res.json({ ok: false, error: 'Analyzer agent not found. Ensure agent-analyzer.yaml exists in agents/examples/.' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const focus = typeof body.focus === 'string' ? body.focus.trim() : '';
  const targetYaml = exportAgent(target);

  // Fetch the most recent completed run for this agent so the analyzer
  // can consider real execution output (errors, timeouts, etc.).
  let lastRunOutput = '';
  try {
    const recent = ctx.runStore.listRuns({ agentName: name, status: 'completed', limit: 1 });
    if (recent.length > 0 && recent[0].result) {
      const raw = recent[0].result;
      // Cap at 2000 chars to keep the prompt focused.
      lastRunOutput = raw.length > 2000 ? raw.slice(0, 2000) + '\n...(truncated)' : raw;
    }
  } catch { /* run store may not have runs yet */ }

  // Fire-and-forget: start the analyzer but don't await it.
  // Return the runId immediately so the client can poll.
  // Build discovery catalog for the analyzer.
  const aBuiltins = listBuiltinTools();
  let aUserTools: ToolDefinition[] = [];
  try { if (ctx.toolStore) aUserTools = ctx.toolStore.listTools(); } catch {}
  const discoveryCatalog = buildDiscoveryCatalog({
    agents: ctx.agentStore.listAgents(),
    tools: [...aBuiltins, ...aUserTools],
    templateRegistry: TEMPLATE_REGISTRY,
  });

  const runPromise = executeAgentDag(
    analyzer,
    {
      triggeredBy: 'dashboard',
      inputs: {
        AGENT_YAML: targetYaml,
        ...(focus ? { FOCUS: `Focus your analysis on: ${focus}` } : {}),
        ...(lastRunOutput ? { LAST_RUN_OUTPUT: lastRunOutput } : {}),
        DISCOVERY_CATALOG: discoveryCatalog,
      },
    },
    {
      runStore: ctx.runStore,
      secretsStore: ctx.secretsStore,
      variablesStore: ctx.variablesStore,
    },
  );

  // Wait briefly for the run row to be created (near-instant).
  await Promise.race([
    runPromise,
    new Promise((resolve) => setTimeout(resolve, 200)),
  ]);

  // Find the running analyzer run.
  const { rows } = ctx.runStore.queryRuns({
    agentName: ANALYZER_AGENT_ID,
    statuses: ['running', 'completed', 'failed'] as RunStatus[],
    limit: 1,
    offset: 0,
  });

  if (rows.length > 0) {
    res.json({ ok: true, status: 'started', runId: rows[0].id, currentYaml: targetYaml });
  } else {
    // Fallback: wait for the full run.
    try {
      const run = await runPromise;
      res.json({ ok: true, status: 'started', runId: run.id, currentYaml: targetYaml });
    } catch (err) {
      res.json({ ok: false, error: (err as Error).message });
    }
  }
});

/**
 * GET /agents/:name/analyze/:runId — poll the analyzer run status.
 * Returns progress events while running, parsed results when done.
 */
buildRouter.get('/agents/:name/analyze/:runId', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;

  const run = ctx.runStore.getRun(runId);
  if (!run) {
    res.json({ ok: false, status: 'not_found' });
    return;
  }

  // Still running — return progress from node executions.
  if (run.status === 'running' || run.status === 'pending') {
    const execs = ctx.runStore.listNodeExecutions(runId);
    const runningNode = execs.find((e) => e.status === 'running');
    const completedNodes = execs.filter((e) => e.status === 'completed').map((e) => e.nodeId);
    let progress: unknown[] = [];
    if (runningNode?.progressJson) {
      try { progress = JSON.parse(runningNode.progressJson); } catch { /* ignore */ }
    }
    // Add a phase message based on which node is running.
    const phaseMessage = runningNode?.nodeId === 'analyze' ? 'Analyzing agent...'
      : runningNode?.nodeId === 'validate' ? 'Validating suggested YAML...'
      : runningNode?.nodeId === 'fix' ? 'Fixing validation errors...'
      : runningNode ? `Running ${runningNode.nodeId}...`
      : 'Starting...';
    res.json({ ok: true, status: 'running', progress, phase: phaseMessage, completedNodes });
    return;
  }

  // Done — parse the result. Even if the run failed (e.g. fix node hit
  // max_turns), the analyze node may have completed successfully. Try to
  // extract results from individual node executions before giving up.
  const execs = ctx.runStore.listNodeExecutions(runId);
  const analyzeExec = execs.find((e) => e.nodeId === 'analyze');
  const fixExec = execs.find((e) => e.nodeId === 'fix');

  // Pick the best available result text:
  // 1. Fix node output (corrected YAML) if it completed
  // 2. Run-level result if the run completed
  // 3. Analyze node output as fallback (even if later nodes failed)
  let resultText = '';
  if (fixExec?.status === 'completed' && fixExec.result) {
    resultText = fixExec.result;
  } else if (run.status === 'completed' && run.result) {
    resultText = run.result;
  } else if (analyzeExec?.status === 'completed' && analyzeExec.result) {
    resultText = analyzeExec.result;
  }

  if (!resultText || !resultText.includes('<classification>')) {
    // Try the analyze node one more time — its result may be in stream-json format
    if (analyzeExec?.result && analyzeExec.result.includes('<classification>')) {
      resultText = analyzeExec.result;
    } else if (!resultText) {
      res.json({ ok: true, status: 'failed', error: run.error ?? `Analysis failed (${run.status}).` });
      return;
    }
  }

  if (!resultText.includes('<classification>')) {
    // Result is probably the validate node's JSON. Find the analyze node's output.
    if (analyzeExec?.result) {
      resultText = analyzeExec.result;
    }
  }

  const extract = (tag: string): string | undefined => {
    const m = resultText.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
    return m ? m[1].trim() : undefined;
  };
  const classRaw = extract('classification')?.toUpperCase().trim() ?? 'SUGGESTIONS';
  const classification = ['NO_IMPROVEMENTS', 'SUGGESTIONS', 'REWRITE'].includes(classRaw) ? classRaw : 'SUGGESTIONS';

  // Extract suggested YAML and auto-fix common analyzer mistakes before validation.
  let suggestedYaml = extract('yaml') || undefined;
  let yamlError: string | undefined;
  if (suggestedYaml && suggestedYaml.length > 10) {
    // Fix {{inputs.X}} → $X in shell node commands (analyzer LLM gets this wrong often).
    try {
      const raw = parseRawYaml(suggestedYaml);
      if (raw?.nodes && Array.isArray(raw.nodes)) {
        let changed = false;
        for (const n of raw.nodes) {
          if (n.type === 'shell' && typeof n.command === 'string') {
            const fixed = n.command.replace(
              /\{\{inputs\.([A-Z_][A-Z0-9_]*)\}\}/g,
              (_: string, name: string) => '$' + name,
            );
            if (fixed !== n.command) { n.command = fixed; changed = true; }
          }
        }
        if (changed) suggestedYaml = stringifyRawYaml(raw, { lineWidth: 0 });
      }
    } catch { /* let the real parser report the error */ }
    try { parseAgent(suggestedYaml); } catch (e) { yamlError = e instanceof Error ? e.message : String(e); }
  }

  const target = ctx.agentStore.getAgent(name);
  const currentYaml = target ? exportAgent(target) : '';

  res.json({
    ok: true,
    status: 'done',
    classification,
    summary: extract('summary') ?? '',
    details: extract('details') ?? run.result,
    yaml: suggestedYaml,
    yamlError,
    currentYaml,
  });
});

// ── Agent Builder (goal-driven wizard) ─────────────────────────────────

/**
 * POST /agents/build — run the agent-builder with a goal prompt.
 * Returns { runId } immediately for polling.
 */
buildRouter.post('/agents/build', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  const focus = typeof body.focus === 'string' ? body.focus.trim() : '';

  if (!goal) {
    res.json({ ok: false, error: 'Goal is required.' });
    return;
  }

  // Auto-import or update builder agent from examples YAML.
  // Uses upsertAgent so prompt improvements take effect without manual deletion.
  let builder: ReturnType<typeof ctx.agentStore.getAgent> = null;
  try {
    const yamlPath = join(resolve('agents/examples'), `${BUILDER_AGENT_ID}.yaml`);
    const yamlText = readFileSync(yamlPath, 'utf-8');
    const parsed = parseAgent(yamlText);
    ctx.agentStore.upsertAgent(parsed, 'import', 'Auto-imported for agent builder');
    builder = ctx.agentStore.getAgent(BUILDER_AGENT_ID);
  } catch { /* fall through */ }
  if (!builder) {
    res.json({ ok: false, error: 'Builder agent not found. Ensure agent-builder.yaml exists in agents/examples/.' });
    return;
  }

  // Build a dynamic tool catalog so the builder LLM knows about all
  // registered tools, not just the 9 hardcoded built-ins.
  const builtins = listBuiltinTools();
  let userTools: ToolDefinition[] = [];
  try {
    if (ctx.toolStore) userTools = ctx.toolStore.listTools();
  } catch { /* store not available */ }
  const catalog = formatToolCatalog([...builtins, ...userTools]);
  const discoveryCatalog = buildDiscoveryCatalog({
    agents: ctx.agentStore.listAgents(),
    tools: [...builtins, ...userTools],
    templateRegistry: TEMPLATE_REGISTRY,
  });

  const runPromise = executeAgentDag(
    builder,
    {
      triggeredBy: 'dashboard',
      inputs: {
        GOAL: goal,
        ...(focus ? { FOCUS: `Constraints: ${focus}` } : {}),
        AVAILABLE_TOOLS: catalog,
        DISCOVERY_CATALOG: discoveryCatalog,
      },
    },
    {
      runStore: ctx.runStore,
      secretsStore: ctx.secretsStore,
      variablesStore: ctx.variablesStore,
    },
  );

  await Promise.race([
    runPromise,
    new Promise((resolve) => setTimeout(resolve, 200)),
  ]);

  const { rows } = ctx.runStore.queryRuns({
    agentName: BUILDER_AGENT_ID,
    statuses: ['running', 'completed', 'failed'] as RunStatus[],
    limit: 1,
    offset: 0,
  });

  if (rows.length > 0) {
    res.json({ ok: true, status: 'started', runId: rows[0].id });
  } else {
    try {
      const run = await runPromise;
      res.json({ ok: true, status: 'started', runId: run.id });
    } catch (err) {
      res.json({ ok: false, error: (err as Error).message });
    }
  }
});

/**
 * GET /agents/build/:runId — poll builder run status.
 * Returns YAML when done so the client can preview + create.
 */
buildRouter.get('/agents/build/:runId', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;

  const run = ctx.runStore.getRun(runId);
  if (!run) {
    res.json({ ok: false, status: 'not_found' });
    return;
  }

  if (run.status === 'running' || run.status === 'pending') {
    const execs = ctx.runStore.listNodeExecutions(runId);
    const runningNode = execs.find((e) => e.status === 'running');
    const phaseMessage = runningNode?.nodeId === 'design' ? 'Designing agent...'
      : runningNode?.nodeId === 'validate' ? 'Validating YAML...'
      : runningNode?.nodeId === 'fix' ? 'Fixing validation errors...'
      : 'Starting...';
    let progress: unknown[] = [];
    if (runningNode?.progressJson) {
      try { progress = JSON.parse(runningNode.progressJson); } catch { /* */ }
    }
    res.json({ ok: true, status: 'running', phase: phaseMessage, progress });
    return;
  }

  if (run.status !== 'completed' || !run.result) {
    res.json({ ok: true, status: 'failed', error: run.error ?? `Build failed (${run.status}).` });
    return;
  }

  // Extract YAML from the result (may come from design or fix node).
  let resultText = run.result;
  if (!resultText.includes('<yaml>')) {
    const execs = ctx.runStore.listNodeExecutions(runId);
    const fixExec = execs.find((e) => e.nodeId === 'fix' && e.status === 'completed');
    const designExec = execs.find((e) => e.nodeId === 'design');
    if (fixExec?.result) resultText = fixExec.result;
    else if (designExec?.result) resultText = designExec.result;
  }

  const yamlMatch = resultText.match(/<yaml>([\s\S]*?)<\/yaml>/i);
  const yaml = yamlMatch ? yamlMatch[1].trim() : undefined;

  if (!yaml) {
    res.json({ ok: true, status: 'failed', error: 'Builder did not produce valid YAML.' });
    return;
  }

  // Validate the YAML.
  let agentId: string | undefined;
  let agentName: string | undefined;
  let yamlError: string | undefined;
  try {
    const parsed = parseAgent(yaml);
    agentId = parsed.id;
    agentName = parsed.name;
  } catch (e) {
    yamlError = e instanceof Error ? e.message : String(e);
  }

  res.json({
    ok: true,
    status: 'done',
    yaml,
    agentId,
    agentName,
    yamlError,
  });
});

/**
 * POST /agents/build/create — create an agent from builder-suggested YAML.
 */
buildRouter.post('/agents/build/create', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const yaml = typeof body.yaml === 'string' ? body.yaml : '';

  if (!yaml.trim()) {
    res.json({ ok: false, error: 'No YAML provided.' });
    return;
  }

  let parsed;
  try {
    parsed = parseAgent(yaml);
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    return;
  }

  // Check if agent already exists.
  if (ctx.agentStore.getAgent(parsed.id)) {
    res.json({ ok: false, error: `Agent "${parsed.id}" already exists. Edit the YAML to use a different id.` });
    return;
  }

  try {
    ctx.agentStore.createAgent(
      { ...parsed, source: 'local' },
      'dashboard',
      'Created via Build from goal wizard',
    );
    res.json({ ok: true, agentId: parsed.id });
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
