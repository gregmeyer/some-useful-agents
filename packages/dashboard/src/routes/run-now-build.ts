/**
 * Agent analyze + build routes. Extracted from run-now.ts.
 *
 * Analyze: POST/GET /agents/:name/analyze — suggest improvements modal.
 * Build: POST /agents/build, GET /agents/build/:runId, POST /agents/build/create.
 */

import { Router, type Request, type Response } from 'express';
import {
  executeAgentDag,
  exportAgent,
  listBuiltinTools,
  parseAgent,
  buildDiscoveryCatalog,
  buildPlanSchema,
  PlannerLoopRunner,
  defaultCheckImageUrl,
  findSimilarCommittedPlans,
  formatPriorPlansBlock,
  type PriorPlanCandidate,
  type BuildPlan,
  type PlanCriticError,
  type RunStatus,
  type ToolDefinition,
} from '@some-useful-agents/core';
import { TEMPLATE_REGISTRY } from '../views/pulse-templates.js';
import { parse as parseRawYaml, stringify as stringifyRawYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getContext } from '../context.js';
import { buildLlmSettingsSnapshot } from '../lib/llm-settings-snapshot.js';
import {
  startBuildSession,
  startDraftOneSession,
  getSession,
  advanceSession,
  drafterProgress,
} from './build-orchestrator.js';

export const buildRouter: Router = Router();

const ANALYZER_AGENT_ID = 'agent-analyzer';
const BUILDER_AGENT_ID = 'agent-builder';
const PLANNER_AGENT_ID = 'build-planner';

// ── Auto-fix common LLM YAML mistakes ──────────────────────────────────

export function autoFixYaml(yaml: string): string {
  try {
    const raw = parseRawYaml(yaml);
    if (!raw || typeof raw !== 'object') return yaml;
    let changed = false;

    // Fix 1: {{inputs.X}} → $X in shell node commands. Matches both the
    // canonical form and the space-escaped {{ → "{ {" form that the
    // template-substitution pipeline produces when the planner's output
    // is piped through {{upstream.X.result}} (safe-escape protection
    // against double-substitution leaks `{ {inputs.NAME}}` into the saved
    // YAML on disk if we don't catch it here).
    if (raw.nodes && Array.isArray(raw.nodes)) {
      for (const n of raw.nodes) {
        if (n.type === 'shell' && typeof n.command === 'string') {
          const fixed = n.command.replace(
            /\{ ?\{\s*inputs\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
            (_: string, name: string) => '$' + name.toUpperCase(),
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
        if ((n.type === 'claude-code' || n.type === 'llm-prompt') && typeof n.prompt === 'string') {
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
export function formatToolCatalog(tools: ToolDefinition[]): string {
  return tools
    .map((t) => {
      const inputNames = Object.keys(t.inputs ?? {}).join(', ');
      const desc = t.description ? t.description.replace(/\n/g, ' ').trim() : '';
      const implType = t.implementation?.type ?? 'builtin';
      return `- ${t.id} (type: ${implType}): ${desc}${inputNames ? ` Inputs: ${inputNames}.` : ''}`;
    })
    .join('\n');
}

/**
 * Maximum number of *additional* planner attempts after the first one. So
 * total tries = 1 initial + MAX_CRITIC_RETRIES retries = up to 3 calls into
 * the planner per pipeline. After that, surface critic errors to the user
 * with a "Continue anyway" override.
 */
const MAX_CRITIC_RETRIES = 2;

interface PlannerKickoffArgs {
  ctx: ReturnType<typeof getContext>;
  goal: string;
  focus?: string;
  /**
   * When set, this is a retry: append the formatted critic feedback to the
   * goal so the planner sees *exactly* which structural mistakes to fix.
   */
  criticFeedback?: string;
  /**
   * Optional prior-plan examples to inject as a `<priorPlans>` block.
   * Retrieved by `findSimilarCommittedPlans` from `plannerMemoryStore`.
   * Empty / undefined → no injection (the planner's prompt acknowledges
   * the absence gracefully).
   */
  priorPlans?: PriorPlanCandidate[];
}

/**
 * Spawn a single planner agent run and return its run-id. Shared by the
 * initial POST /agents/build call and by the GET-handler's critic-retry
 * loop. Returns null when the planner agent itself can't be loaded
 * (caller surfaces an error to the user).
 */
async function kickoffPlannerRun(args: PlannerKickoffArgs): Promise<string | null> {
  const { ctx, goal, focus, criticFeedback, priorPlans } = args;

  let planner: ReturnType<typeof ctx.agentStore.getAgent> = null;
  try {
    const yamlPath = join(resolve('agents/examples'), `${PLANNER_AGENT_ID}.yaml`);
    const yamlText = readFileSync(yamlPath, 'utf-8');
    const parsed = parseAgent(yamlText);
    ctx.agentStore.upsertAgent(parsed, 'import', 'Auto-imported for build planner');
    planner = ctx.agentStore.getAgent(PLANNER_AGENT_ID);
  } catch { /* fall through */ }
  if (!planner) return null;

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
    dashboards: ctx.dashboardsStore?.listDashboards(),
    packs: ctx.packsStore?.listPacks(),
  });

  // Append critic feedback + prior-plan examples to the goal. Keeps the
  // rest of the input pipeline unchanged — the planner prompt
  // acknowledges both <plan> and <priorPlans>.
  const priorBlock = priorPlans && priorPlans.length > 0 ? formatPriorPlansBlock(priorPlans) : '';
  const memoryDisabled = process.env.SUA_PLANNER_MEMORY_DISABLED === '1';
  const parts = [goal];
  if (priorBlock && !memoryDisabled) parts.push(priorBlock);
  if (criticFeedback) parts.push(criticFeedback);
  const effectiveGoal = parts.join('\n');

  const runPromise = executeAgentDag(
    planner,
    {
      triggeredBy: 'dashboard',
      inputs: {
        GOAL: effectiveGoal,
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
      llmSettings: buildLlmSettingsSnapshot(ctx),
    },
  );

  // Race the run-record creation; we only need its id, not its result.
  await Promise.race([runPromise, new Promise((r) => setTimeout(r, 200))]);
  const { rows } = ctx.runStore.queryRuns({
    agentName: PLANNER_AGENT_ID,
    statuses: ['running', 'completed', 'failed'] as RunStatus[],
    limit: 1,
    offset: 0,
  });
  if (rows.length > 0) return rows[0].id;
  try {
    const run = await runPromise;
    return run.id;
  } catch {
    return null;
  }
}

/**
 * Build a stable `existingAgentIds` Set from the current AgentStore.
 * Used by the critic to check survey.matchedAgents and dashboard refs
 * against catalog reality.
 */
function loadExistingAgentIds(ctx: ReturnType<typeof getContext>): Set<string> {
  try {
    return new Set(ctx.agentStore.listAgents().map((a) => a.id));
  } catch {
    return new Set();
  }
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
      llmSettings: buildLlmSettingsSnapshot(ctx),
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
        llmSettings: buildLlmSettingsSnapshot(ctx),
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
 * POST /agents/build — run the multi-stage build orchestrator
 * (goal-surveyor → agent-drafter × N → dashboard-designer).
 * Returns a session id (used as runId) for polling.
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

  const sessionId = await startBuildSession({ ctx, goal, focus });
  if (!sessionId) {
    res.json({
      ok: false,
      error: 'Goal surveyor agent not found. Ensure goal-surveyor.yaml exists in agents/examples/.',
    });
    return;
  }

  res.json({ ok: true, status: 'started', runId: sessionId });

  // Telemetry: record the session as a planner run for /metrics/planner
  // continuity. Best-effort — failure is silent.
  if (ctx.plannerTelemetryStore) {
    try { ctx.plannerTelemetryStore.recordStart(sessionId, goal); } catch { /* swallow */ }
  }
});

/**
 * POST /agents/draft-one — single-spec drafter for the Improve-layout
 * Path B inline-drafting flow. Skips the goal-surveyor (the layout
 * planner already produced the spec) and the dashboard-designer (the
 * layout planner owns dashboard layout). Just runs one agent-drafter
 * and assembles a single-agent BuildPlan when it completes.
 *
 * Body: { purpose: string, suggestedName?: string, focus?: string }
 * Returns: { ok, runId } where runId is a session-id polled via
 * GET /agents/build/:runId — the orchestrator state machine handles both.
 */
buildRouter.post('/agents/draft-one', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';
  const suggestedName = typeof body.suggestedName === 'string' && body.suggestedName.trim()
    ? body.suggestedName.trim()
    : undefined;
  const focus = typeof body.focus === 'string' ? body.focus.trim() : '';

  if (!purpose) {
    res.json({ ok: false, error: 'purpose is required.' });
    return;
  }

  const sessionId = await startDraftOneSession({ ctx, purpose, suggestedName, focus });
  if (!sessionId) {
    res.json({
      ok: false,
      error: 'Agent drafter not found. Ensure agent-drafter.yaml exists in agents/examples/.',
    });
    return;
  }
  res.json({ ok: true, status: 'started', runId: sessionId });
});

/**
 * GET /agents/build/:runId — poll the orchestrator session.
 * Drives the session state machine on each poll, then formats the
 * current phase for the wizard.
 */
buildRouter.get('/agents/build/:runId', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;

  // Orchestrator session: dispatch state machine on each poll.
  const session = getSession(runId);
  if (session) {
    await advanceSession(ctx, session);
    if (session.phase === 'failed') {
      res.json({ ok: true, status: 'failed', error: session.error ?? 'Build failed.' });
      return;
    }
    if (session.phase === 'done' && session.plan) {
      res.json({ ok: true, status: 'done', plan: session.plan });
      return;
    }
    if (session.phase === 'nothing_to_build') {
      // Goal already covered by installed agents — nothing new to draft.
      res.json({
        ok: true,
        status: 'nothing_to_build',
        summary: session.survey?.summary ?? 'Your goal is already covered by existing agents.',
        matchedAgents: session.survey?.matchedAgents ?? [],
      });
      return;
    }
    // Still running. Surface per-drafter progress when present.
    const progress = drafterProgress(ctx, session);
    res.json({
      ok: true,
      status: 'running',
      phase: session.phaseMessage,
      ...(progress ? { progress } : {}),
    });
    return;
  }

  // Fall-through: a legacy raw runId (no session). Preserved for
  // backward compat with any external script polling a planner runId
  // directly — should be unused in the wizard now.
  const run = ctx.runStore.getRun(runId);
  if (!run) {
    res.json({ ok: false, status: 'not_found' });
    return;
  }

  if (run.status === 'running' || run.status === 'pending') {
    const execs = ctx.runStore.listNodeExecutions(runId);
    const runningNode = execs.find((e) => e.status === 'running');
    const phaseMessage = runningNode?.nodeId === 'plan' ? 'Planning agents and dashboard...'
      : runningNode?.nodeId === 'design' ? 'Designing agent...'
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

  // Detect which agent produced this run (planner emits a plan; the
  // legacy agent-builder still emits raw YAML).
  const ranPlanner = run.agentName === PLANNER_AGENT_ID;

  if (ranPlanner) {
    // The extract → autofix → critic → smoke → maybe-retry sequence is
    // driven by PlannerLoopRunner. PR 2 added the smoke-run eval and
    // persists per-step records to the planner_loop_steps table for
    // observability.
    const planMs = run.completedAt && run.startedAt
      ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
      : 0;
    const execs = ctx.runStore.listNodeExecutions(runId);
    const planExec = execs.find((e) => e.nodeId === 'plan' && e.status === 'completed');

    const loopRunner = new PlannerLoopRunner({
      telemetryStore: ctx.plannerTelemetryStore,
      kickoffPlannerRun: ({ goal, criticFeedback, priorPlans }) => kickoffPlannerRun({ ctx, goal, criticFeedback, priorPlans }),
      autoFixYaml,
      loadExistingAgentIds: () => loadExistingAgentIds(ctx),
      loadKnownToolIds: () => {
        const builtinIds = new Set(listBuiltinTools().map((t) => t.id));
        try {
          if (ctx.toolStore) for (const t of ctx.toolStore.listTools()) builtinIds.add(t.id);
        } catch { /* tool store unavailable */ }
        return builtinIds;
      },
      checkImageUrl: defaultCheckImageUrl,
      memoryStore: ctx.plannerMemoryStore,
      maxRetries: MAX_CRITIC_RETRIES,
    });

    const outcome = await loopRunner.advance({
      runId,
      runResult: run.result,
      nodeExecResult: planExec?.result,
      planMs,
    });

    // Persist the loop's step log. Attempt number = planAttempts at the
    // root telemetry row (advance() incremented it before spawning a retry,
    // so this captures the just-completed attempt's number cleanly).
    if (ctx.plannerLoopStepLogStore) {
      try {
        const rootRunId = ctx.plannerTelemetryStore?.resolveOriginalRunId(runId) ?? runId;
        const attempt = ctx.plannerTelemetryStore?.get(rootRunId)?.planAttempts ?? 1;
        ctx.plannerLoopStepLogStore.appendSteps({ runId: rootRunId, attempt, steps: outcome.steps });
      } catch { /* swallow */ }
    }

    if (outcome.kind === 'failed') {
      res.json({ ok: true, status: 'failed', error: outcome.error, ...(outcome.rawPlan !== undefined ? { rawPlan: outcome.rawPlan } : {}) });
      return;
    }
    if (outcome.kind === 'retrying') {
      res.json({
        ok: true,
        status: 'retrying',
        runId: outcome.retryRunId,
        attempt: outcome.attempt,
        criticErrors: outcome.criticErrors,
        ...(outcome.smoke && !outcome.smoke.ok ? { smokeErrors: outcome.smoke.perAgent } : {}),
        phase: outcome.phase,
      });
      return;
    }
    // 'done'
    res.json({
      ok: true,
      status: 'done',
      plan: outcome.plan,
      ...(outcome.criticErrors ? { criticErrors: outcome.criticErrors } : {}),
      ...(outcome.smoke && !outcome.smoke.ok ? { smokeErrors: outcome.smoke.perAgent } : {}),
      ...(outcome.criticWarning ? { criticWarning: outcome.criticWarning } : {}),
    });
    return;
  }

  // Legacy agent-builder path — kept for any external script still
  // hitting POST /agents/build (the wizard's own route now uses the
  // planner).
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

  res.json({ ok: true, status: 'done', yaml, agentId, agentName, yamlError });
});

/**
 * POST /agents/build/commit — execute an approved BuildPlan.
 *
 * Walks `plan.newAgents` creating each via agentStore (skipping any whose
 * id already exists). Then if `plan.dashboard` is non-null, upserts the
 * dashboard via dashboardsStore. Returns a partial-success report so
 * the wizard can show what landed and what didn't.
 */
buildRouter.post('/agents/build/commit', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Optional: the wizard sends the planner runId so we can correlate this
  // commit with its planner-run row in planner_telemetry. Older clients
  // that don't send it just skip the commit-time telemetry update.
  const plannerRunId = typeof body.plannerRunId === 'string' ? body.plannerRunId : undefined;

  const result = buildPlanSchema.safeParse(body.plan);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    res.json({ ok: false, error: `Plan failed validation: ${issues}` });
    return;
  }
  const plan = result.data;

  // Optional landing target from the wizard. Three shapes:
  //   { kind: 'agents-only' }
  //   { kind: 'new-dashboard' }
  //   { kind: 'existing-dashboard', dashboardId: string }
  // Older clients send no target — fall back to planner's plan.dashboard.
  let target: { kind: 'agents-only' } | { kind: 'new-dashboard' } | { kind: 'existing-dashboard'; dashboardId: string } | null = null;
  if (body.target && typeof body.target === 'object') {
    const t = body.target as Record<string, unknown>;
    if (t.kind === 'agents-only') target = { kind: 'agents-only' };
    else if (t.kind === 'new-dashboard') target = { kind: 'new-dashboard' };
    else if (t.kind === 'existing-dashboard' && typeof t.dashboardId === 'string') target = { kind: 'existing-dashboard', dashboardId: t.dashboardId };
  }
  // Honor "agents-only": drop the planner's dashboard so nothing extra lands.
  if (target?.kind === 'agents-only') {
    plan.dashboard = null;
  }
  // "existing-dashboard": drop the planner's new dashboard — we'll merge into
  // the user-selected one after the agents commit.
  if (target?.kind === 'existing-dashboard') {
    plan.dashboard = null;
  }

  const agentsCreated: string[] = [];
  const agentsSkipped: Array<{ id: string; reason: string }> = [];

  for (const ref of plan.newAgents) {
    if (ctx.agentStore.getAgent(ref.id)) {
      agentsSkipped.push({ id: ref.id, reason: 'agent id already exists' });
      continue;
    }
    let parsed;
    try {
      const fixedYaml = autoFixYaml(ref.yaml);
      parsed = parseAgent(fixedYaml);
    } catch (e) {
      agentsSkipped.push({ id: ref.id, reason: `YAML parse failed: ${(e as Error).message}` });
      continue;
    }
    if (parsed.id !== ref.id) {
      agentsSkipped.push({ id: ref.id, reason: `YAML id "${parsed.id}" does not match plan ref id "${ref.id}"` });
      continue;
    }
    try {
      ctx.agentStore.createAgent(
        { ...parsed, source: 'local' },
        'dashboard',
        `Created via Build from goal wizard (intent: ${plan.intent})`,
      );
      agentsCreated.push(ref.id);
      // Auto-run the freshly created agent once so its Pulse tile
      // shows actual output instead of empty placeholders the first
      // time the user opens the dashboard. Fire-and-forget: errors
      // surface as a failed run in /runs that the user can re-trigger
      // with inputs if needed (e.g. agents that require user-supplied
      // values). The agentStore.getAgent() round-trip is intentional —
      // it picks up any normalization the store applies on insert.
      try {
        const stored = ctx.agentStore.getAgent(ref.id);
        if (stored) {
          executeAgentDag(
            stored,
            { triggeredBy: 'dashboard', inputs: {} },
            {
              runStore: ctx.runStore,
              secretsStore: ctx.secretsStore,
              variablesStore: ctx.variablesStore,
              dataRoot: ctx.agentStore.dataRoot,
              llmSettings: buildLlmSettingsSnapshot(ctx),
            },
          ).catch(() => { /* surfaced as a failed run row */ });
        }
      } catch { /* best-effort — don't let auto-run failures block the commit */ }
    } catch (e) {
      agentsSkipped.push({ id: ref.id, reason: (e as Error).message });
    }
  }

  let dashboardCreated: string | null = null;
  let dashboardError: string | undefined;
  if (plan.dashboard && ctx.dashboardsStore) {
    // Integrity check: every agentId the dashboard references must
    // either already exist in AgentStore or have just been created.
    // Otherwise we'd persist a dashboard pointing at agents that
    // never landed (e.g. their YAML failed to parse) — the user
    // sees broken "not installed" tiles with no clear cause.
    const createdSet = new Set(agentsCreated);
    const referencedIds = new Set<string>();
    for (const s of plan.dashboard.sections) for (const id of s.agentIds) referencedIds.add(id);
    const unmet: string[] = [];
    for (const id of referencedIds) {
      if (createdSet.has(id)) continue;
      if (ctx.agentStore.getAgent(id)) continue;
      unmet.push(id);
    }
    if (unmet.length > 0) {
      const skippedDetail = agentsSkipped.length
        ? ` ${agentsSkipped.map((s) => `${s.id}: ${s.reason}`).join('; ')}`
        : '';
      dashboardError = `Dashboard references ${unmet.length} agent${unmet.length === 1 ? '' : 's'} that did not land: ${unmet.join(', ')}.${skippedDetail}`;
    } else {
      try {
        ctx.dashboardsStore.upsertDashboard({
          id: plan.dashboard.id,
          packId: null,
          name: plan.dashboard.name,
          layout: { sections: plan.dashboard.sections },
        });
        dashboardCreated = plan.dashboard.id;
      } catch (e) {
        dashboardError = (e as Error).message;
      }
    }
  } else if (plan.dashboard && !ctx.dashboardsStore) {
    dashboardError = 'Dashboards store unavailable.';
  }

  // Target = "new-dashboard": synthesize a user dashboard with every agent
  // we just created, if the planner didn't already produce one.
  if (target?.kind === 'new-dashboard' && !dashboardCreated && agentsCreated.length > 0 && ctx.dashboardsStore) {
    const baseId = 'user:goal';
    let dashId = baseId;
    if (ctx.dashboardsStore.getDashboard(dashId)) dashId = `${baseId}-${Date.now().toString(36)}`;
    const name = 'Built from goal';
    try {
      ctx.dashboardsStore.upsertDashboard({
        id: dashId,
        packId: null,
        name,
        layout: { sections: [{ title: 'Agents', agentIds: agentsCreated.slice() }] },
      });
      dashboardCreated = dashId;
    } catch (e) {
      dashboardError = (e as Error).message;
    }
  }

  // Target = "existing-dashboard": append every agent we just created to
  // section 0 of the user-selected dashboard. New tiles are added (existing
  // agentIds in section 0 are preserved).
  let dashboardUpdated: string | null = null;
  if (target?.kind === 'existing-dashboard' && agentsCreated.length > 0 && ctx.dashboardsStore) {
    const dash = ctx.dashboardsStore.getDashboard(target.dashboardId);
    if (!dash) {
      dashboardError = `Dashboard "${target.dashboardId}" not found.`;
    } else if (dash.packId) {
      dashboardError = 'Cannot add to a pack-owned dashboard. Pick a user dashboard.';
    } else if (dash.layout.sections.length === 0) {
      // No sections to append to — create one.
      try {
        ctx.dashboardsStore.updateLayout(dash.id, {
          sections: [{ title: 'Agents', agentIds: agentsCreated.slice() }],
        });
        dashboardUpdated = dash.id;
      } catch (e) { dashboardError = (e as Error).message; }
    } else {
      const sections = dash.layout.sections.map((s, i) => {
        if (i !== 0) return s;
        const existing = new Set(s.agentIds);
        const merged = [...s.agentIds, ...agentsCreated.filter((id) => !existing.has(id))];
        return { ...s, agentIds: merged };
      });
      try {
        ctx.dashboardsStore.updateLayout(dash.id, { sections });
        dashboardUpdated = dash.id;
      } catch (e) { dashboardError = (e as Error).message; }
    }
  }

  // Telemetry: stamp the commit time + total time-to-commit. Only fires
  // when the wizard supplied plannerRunId (correlates this commit back
  // to its planner-run row) AND something actually landed (an agent was
  // created or a dashboard was upserted). A "Commit" click that ends with
  // zero creates is not a successful commit — counting it would inflate
  // /metrics/planner's commit-rate for failures the user just dismissed.
  const somethingLanded = agentsCreated.length > 0 || dashboardCreated !== null;
  if (plannerRunId && somethingLanded && ctx.plannerTelemetryStore) {
    try {
      const plannerRun = ctx.runStore.getRun(plannerRunId);
      if (plannerRun?.startedAt) {
        const ms = Date.now() - new Date(plannerRun.startedAt).getTime();
        ctx.plannerTelemetryStore.recordCommit(plannerRunId, ms);
      }
    } catch { /* swallow */ }
  }

  // Cross-run memory write (PR 3): record this committed plan so future
  // planner runs for similar goals see it as a `<priorPlans>` example.
  // Only when something actually landed AND the wizard supplied the
  // plannerRunId AND we have telemetry context to read the original goal
  // + intent + attempts back from.
  if (
    plannerRunId
    && somethingLanded
    && ctx.plannerMemoryStore
    && ctx.plannerTelemetryStore
  ) {
    try {
      const rootRunId = ctx.plannerTelemetryStore.resolveOriginalRunId(plannerRunId);
      const row = ctx.plannerTelemetryStore.get(rootRunId);
      if (row?.goal && row.intent) {
        ctx.plannerMemoryStore.recordCommit({
          runId: rootRunId,
          goal: row.goal,
          intent: row.intent,
          plan,
          attempts: row.planAttempts,
        });
      }
    } catch { /* swallow */ }
  }

  // Choose a redirect target: prefer the dashboard we created or updated,
  // then the first new agent, then /agents.
  const redirectDashId = dashboardCreated ?? dashboardUpdated;
  const redirectUrl = redirectDashId
    ? `/dashboards/${encodeURIComponent(redirectDashId)}`
    : agentsCreated[0]
      ? `/agents/${encodeURIComponent(agentsCreated[0])}`
      : '/agents';

  res.json({
    ok: true,
    agentsCreated,
    agentsSkipped,
    dashboardCreated,
    dashboardUpdated,
    dashboardError,
    redirectUrl,
  });
});

/**
 * POST /agents/build/create — legacy single-agent create endpoint.
 *
 * Kept as a thin compat shim for any external script that still POSTs
 * raw YAML here. Wraps the YAML in a one-agent BuildPlan and forwards
 * to /commit so we have one execution path.
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
    parsed = parseAgent(autoFixYaml(yaml));
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    return;
  }

  if (ctx.agentStore.getAgent(parsed.id)) {
    res.json({ ok: false, error: `Agent "${parsed.id}" already exists. Edit the YAML to use a different id.` });
    return;
  }

  try {
    ctx.agentStore.createAgent(
      { ...parsed, source: 'local' },
      'dashboard',
      'Created via Build from goal wizard (legacy /create)',
    );
    res.json({ ok: true, agentId: parsed.id });
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
