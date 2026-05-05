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

// ── Auto-fix common LLM YAML mistakes ──────────────────────────────────

export function autoFixYaml(yaml: string): string {
  try {
    const raw = parseRawYaml(yaml);
    if (!raw || typeof raw !== 'object') return yaml;
    let changed = false;

    // Fix 1: {{inputs.X}} → $X in shell node commands.
    if (raw.nodes && Array.isArray(raw.nodes)) {
      for (const n of raw.nodes) {
        if (n.type === 'shell' && typeof n.command === 'string') {
          const fixed = n.command.replace(
            /\{\{inputs\.([A-Z_][A-Z0-9_]*)\}\}/g,
            (_: string, name: string) => '$' + name,
          );
          if (fixed !== n.command) { n.command = fixed; changed = true; }
        }
      }
    }

    // Fix 2: inputs as array → object.
    if (Array.isArray(raw.inputs)) {
      const obj: Record<string, unknown> = {};
      for (const item of raw.inputs) {
        if (typeof item === 'object' && item !== null && item.name) {
          const name = String(item.name).toUpperCase();
          const { name: _n, ...rest } = item;
          obj[name] = rest;
          changed = true;
        }
      }
      if (Object.keys(obj).length > 0) {
        raw.inputs = obj;
      }
    }

    // Fix 3: lowercase input names → UPPERCASE.
    if (raw.inputs && typeof raw.inputs === 'object' && !Array.isArray(raw.inputs)) {
      const fixed: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(raw.inputs)) {
        const upper = key.toUpperCase();
        if (upper !== key) changed = true;
        fixed[upper] = val;
      }
      if (changed) raw.inputs = fixed;
    }

    // Fix 4: enum inputs missing values array.
    if (raw.inputs && typeof raw.inputs === 'object' && !Array.isArray(raw.inputs)) {
      for (const [_key, spec] of Object.entries(raw.inputs)) {
        if (typeof spec === 'object' && spec !== null) {
          const s = spec as Record<string, unknown>;
          if (s.type === 'enum' && !Array.isArray(s.values)) {
            if (s.default && typeof s.default === 'string') {
              s.values = [s.default];
              changed = true;
            }
          }
        }
      }
    }

    // Fix 4b: outputs in shorthand form → object form, plus rescue the
    // common LLM mistake of putting a free-text description in the value
    // slot (e.g. `url: YouTube watch URL`). Valid type strings get the
    // canonical { type } expansion; everything else gets coerced to
    // { type: 'string', description: val } since strings are the most
    // permissive output type. Also snake_case any camelCase keys, since
    // the schema rejects them.
    if (raw.outputs && typeof raw.outputs === 'object' && !Array.isArray(raw.outputs)) {
      const validTypes = new Set(['string', 'number', 'boolean', 'object', 'array']);
      const next: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(raw.outputs as Record<string, unknown>)) {
        const snakeKey = key
          .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
          .replace(/[-\s]+/g, '_')
          .toLowerCase();
        if (snakeKey !== key) changed = true;

        let normalised: unknown = val;
        if (typeof val === 'string') {
          if (validTypes.has(val)) {
            normalised = { type: val };
          } else {
            normalised = { type: 'string', description: val };
          }
          changed = true;
        }
        next[snakeKey] = normalised;
      }
      raw.outputs = next;
    }

    // Fix 5: source: "examples" or "community" → "local".
    if (raw.source && raw.source !== 'local') {
      raw.source = 'local';
      changed = true;
    }

    // Fix 6: repair broken template syntax in claude-code prompts.
    // The escape function in resolveUpstreamTemplate converts {{ to { {
    // to prevent re-expansion. If an LLM or round-trip saves this escaped
    // form, fix it back so templates resolve at runtime.
    const unescapeBraces = (s: string): string =>
      s.replace(/\{ \{/g, '{{').replace(/\} \}/g, '}}');
    if (raw.nodes && Array.isArray(raw.nodes)) {
      for (const n of raw.nodes) {
        if (n.type === 'claude-code' && typeof n.prompt === 'string') {
          const fixed = n.prompt
            .replace(/\{ \{upstream\./g, '{{upstream.')
            .replace(/\{ \{inputs\./g, '{{inputs.')
            .replace(/\{ \{vars\./g, '{{vars.');
          if (fixed !== n.prompt) { n.prompt = fixed; changed = true; }
        }
      }
    }
    // Fix 6b: same un-escape on outputWidget.template — same root cause
    // (escaped form gets pasted back), but a different storage slot.
    // Without this, the renderer prints `{ {outputs.X}}` literally.
    if (raw.outputWidget && typeof raw.outputWidget === 'object'
        && typeof raw.outputWidget.template === 'string') {
      const fixed = unescapeBraces(raw.outputWidget.template);
      if (fixed !== raw.outputWidget.template) {
        raw.outputWidget.template = fixed;
        changed = true;
      }
    }

    // Fix 7: conditional nodes missing conditionalConfig — add a default.
    if (raw.nodes && Array.isArray(raw.nodes)) {
      for (const n of raw.nodes) {
        if (n.type === 'conditional' && !n.conditionalConfig) {
          // Infer predicate from node context.
          n.conditionalConfig = { predicate: { field: 'error', exists: false } };
          changed = true;
        }
        if (n.type === 'switch' && !n.switchConfig) {
          n.switchConfig = { field: 'status', cases: { success: 'success', failed: 'failed' } };
          changed = true;
        }
      }
    }

    // Fix 8: outputWidget.fields[] with `source:` / `path:` / `from:` / `key:`.
    // The widget schema only has `name:` (the JSON key) and `label:` (display).
    // The LLM consistently invents one of these aliases. If the field has a
    // `name:` that looks like a label (capitalized words) AND a `path:` /
    // `source:` / `from:` / `key:` value that looks like a JSON key
    // (snake_case or single word), swap them: name=path, label=name.
    // Otherwise just rename path/source/from/key → name.
    if (raw.outputWidget && Array.isArray(raw.outputWidget.fields)) {
      for (const f of raw.outputWidget.fields) {
        if (typeof f !== 'object' || f === null) continue;
        const aliasKey = ['source', 'path', 'from', 'key'].find(
          (k) => typeof f[k] === 'string' && f[k],
        );
        if (!aliasKey) continue;
        const aliasVal = String(f[aliasKey]);
        const looksLikeLabel = typeof f.name === 'string' && /[A-Z\s]/.test(f.name);
        if (looksLikeLabel) {
          // name is really a label — swap.
          if (!f.label) f.label = f.name;
          f.name = aliasVal.split('.').pop() ?? aliasVal; // strip output. prefix if present
        } else if (!f.name) {
          f.name = aliasVal.split('.').pop() ?? aliasVal;
        }
        delete f[aliasKey];
        changed = true;
      }
    }

    // Fix 9: signal.template not in the registry. Fall back to text-headline
    // (the safest default — accepts a headline + body mapping).
    const VALID_SIGNAL_TEMPLATES = new Set([
      'metric', 'time-series', 'text-headline', 'text-image', 'image',
      'table', 'status', 'media', 'widget', 'comparison', 'key-value',
      'story', 'funnel',
    ]);
    if (raw.signal && typeof raw.signal === 'object'
        && typeof raw.signal.template === 'string'
        && !VALID_SIGNAL_TEMPLATES.has(raw.signal.template)) {
      raw.signal.template = 'text-headline';
      changed = true;
    }

    // Fix 10a: signal.mapping values must be strings (field names), but
    // LLMs sometimes inline structured data (arrays of {label,value} or
    // nested objects). Replace any non-string mapping value with "result"
    // — a safe default that maps to the full output.
    if (raw.signal && typeof raw.signal === 'object' && raw.signal.mapping
        && typeof raw.signal.mapping === 'object') {
      for (const [k, v] of Object.entries(raw.signal.mapping)) {
        if (typeof v !== 'string') {
          raw.signal.mapping[k] = 'result';
          changed = true;
        }
      }
    }

    // Fix 10b: outputWidget.title is invented — schema has no such field.
    // Silently strip; the agent's `name:` is the user-facing label.
    if (raw.outputWidget && typeof raw.outputWidget === 'object'
        && 'title' in raw.outputWidget) {
      delete raw.outputWidget.title;
      changed = true;
    }

    // Fix 10c: signal.title with JSEP-style expression syntax. Strip the
    // expression and use the agent name as a fallback.
    if (raw.signal && typeof raw.signal === 'object' && typeof raw.signal.title === 'string') {
      // A title like "'Weather: ' + output.city" — quoted literal followed by
      // operators. Extract the first quoted segment as the title.
      const exprMatch = raw.signal.title.match(/^\s*['"]([^'"]+)['"]\s*[+&]/);
      if (exprMatch) {
        raw.signal.title = exprMatch[1].trim().replace(/[\s:]+$/, '');
        changed = true;
      }
    }

    if (changed) return stringifyRawYaml(raw, { lineWidth: 0 });
  } catch { /* if raw parse fails, return as-is */ }
  return yaml;
}

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

  // Fetch the most recent runs (completed AND failed) so the analyzer
  // can consider real execution output, errors, and timeouts.
  let lastRunOutput = '';
  try {
    // Try completed first.
    const completed = ctx.runStore.listRuns({ agentName: name, status: 'completed', limit: 1 });
    if (completed.length > 0 && completed[0].result) {
      const raw = completed[0].result;
      lastRunOutput = raw.length > 2000 ? raw.slice(0, 2000) + '\n...(truncated)' : raw;
    }

    // Also check for recent failed runs — include the error so the
    // analyzer can diagnose what went wrong without the user pasting it.
    const failed = ctx.runStore.listRuns({ agentName: name, status: 'failed', limit: 1 });
    if (failed.length > 0) {
      const f = failed[0];
      const failedAt = f.completedAt ?? f.startedAt;
      const completedAt = completed[0]?.completedAt ?? '';
      // Include if the failure is more recent than the last success.
      if (!completedAt || failedAt > completedAt) {
        const errorInfo = [
          `\n\nMOST RECENT RUN FAILED (${f.id.slice(0, 8)}):`,
          f.error ? `Error: ${f.error}` : '',
          f.result ? `Output: ${f.result.slice(0, 1000)}` : '',
        ].filter(Boolean).join('\n');
        lastRunOutput += errorInfo;

        // Also include per-node errors from the failed run.
        try {
          const execs = ctx.runStore.listNodeExecutions(f.id);
          const failedNodes = execs.filter((e) => e.status === 'failed');
          if (failedNodes.length > 0) {
            lastRunOutput += '\n\nFailed nodes:';
            for (const e of failedNodes) {
              lastRunOutput += `\n- ${e.nodeId}: ${e.error ?? 'no error message'}`;
              if (e.result) lastRunOutput += ` | output: ${e.result.slice(0, 200)}`;
            }
          }
        } catch { /* node executions might not exist */ }
      }
    }

    // Cap total size.
    if (lastRunOutput.length > 3000) {
      lastRunOutput = lastRunOutput.slice(0, 3000) + '\n...(truncated)';
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
      dataRoot: ctx.agentStore.dataRoot,
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
    suggestedYaml = autoFixYaml(suggestedYaml);
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

// ── YAML auto-fix via LLM ───────────────────────────────────────────────

/**
 * POST /agents/:name/analyze/fix-yaml — send broken YAML + error to Claude
 * for a fix attempt. Returns { yaml, yamlError? } synchronously (waits for
 * the LLM response, ~10-30s).
 */
buildRouter.post('/agents/:name/analyze/fix-yaml', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const brokenYaml = typeof body.yaml === 'string' ? body.yaml : '';
  const error = typeof body.error === 'string' ? body.error : '';

  if (!brokenYaml || !error) {
    res.json({ ok: false, error: 'Missing yaml or error fields.' });
    return;
  }

  // Build a one-shot fix agent inline (no YAML file needed).
  const fixAgent = {
    id: '_yaml-fixer',
    name: 'YAML Fixer',
    description: 'Fix YAML validation errors',
    status: 'active' as const,
    source: 'local' as const,
    version: 1,
    nodes: [{
      id: 'fix',
      type: 'claude-code' as const,
      prompt: `IMPORTANT: Respond with ONLY the fixed YAML. No explanation, no XML tags, no markdown code fences. Just the raw YAML text.

Fix this sua agent YAML so it passes schema validation.

VALIDATION ERROR:
${error}

BROKEN YAML:
${brokenYaml}

Rules:
- Input names: UPPERCASE_WITH_UNDERSCORES
- Output names: lowercase_snake_case (NOT camelCase). outputs: values must be a type (string|number|boolean|object|array) OR an object {type, description}. NEVER a bare description string in the value slot.
- inputs: must be an object/map, not an array
- enum inputs: must have a non-empty values array
- Shell nodes: use $ENV_VARS for inputs, never double-brace templates
- Claude-code nodes: use double-brace inputs.NAME syntax in prompts
- conditional nodes: must have conditionalConfig with a predicate
- switch nodes: must have switchConfig with field + cases
- outputWidget.type: one of dashboard, key-value, diff-apply, raw
- outputWidget.fields[].type: one of text, code, badge, action, metric, stat
- source: must be "local"
- Keep the same agent id ("${name}")

Output ONLY the complete fixed YAML. Nothing else.`,
      maxTurns: 3,
      timeout: 180,
    }],
  };

  try {
    const run = await executeAgentDag(
      fixAgent,
      { triggeredBy: 'dashboard', inputs: {} },
      {
        runStore: ctx.runStore,
        secretsStore: ctx.secretsStore,
        variablesStore: ctx.variablesStore,
        dataRoot: ctx.agentStore.dataRoot,
      },
    );

    // Wait for completion. Window slightly exceeds the agent's timeout
    // so a slow Claude response surfaces as an LLM-level error rather
    // than a router-level timeout.
    const maxWait = 200_000;
    const pollInterval = 1_000;
    const startTime = Date.now();
    let result = ctx.runStore.getRun(run.id);

    while (result && (result.status === 'running' || result.status === 'pending') && Date.now() - startTime < maxWait) {
      await new Promise((r) => setTimeout(r, pollInterval));
      result = ctx.runStore.getRun(run.id);
    }

    if (!result?.result) {
      res.json({
        ok: false,
        error:
          "Auto-fix didn't return a corrected YAML in time. The suggested rewrite is still " +
          "available — click Edit manually to apply it as a starting point and resolve the " +
          "validation error yourself.",
      });
      return;
    }

    // Clean up the result — strip markdown fences, XML tags, etc.
    let fixedYaml = result.result
      .replace(/^```ya?ml?\n?/i, '')
      .replace(/\n?```\s*$/, '')
      .replace(/<yaml>\n?/gi, '')
      .replace(/\n?<\/yaml>/gi, '')
      .trim();

    // Apply auto-fixers.
    fixedYaml = autoFixYaml(fixedYaml);

    // Validate.
    let fixError: string | undefined;
    try {
      parseAgent(fixedYaml);
    } catch (e) {
      fixError = e instanceof Error ? e.message : String(e);
    }

    res.json({ ok: true, yaml: fixedYaml, yamlError: fixError });
  } catch (err) {
    res.json({ ok: false, error: (err as Error).message });
  }
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
      dataRoot: ctx.agentStore.dataRoot,
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
