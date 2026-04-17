/**
 * Environment building for DAG node execution. Assembles the env map
 * from process.env allowlists, YAML env fields, secrets, global variables,
 * caller inputs, and upstream results. Extracted from dag-executor.ts.
 */

import type { Agent, AgentNode, NodeOutput } from './agent-v2-types.js';
import type { DagExecutorDeps } from './dag-executor.js';
import { resolveUpstreamTemplate, resolveVarsTemplate } from './node-templates.js';
import { substituteInputs, SENSITIVE_ENV_NAMES } from './input-resolver.js';
import { looksLikeSensitive } from './variables-store.js';

// ── Allowlists ─────────────────────────────────────────────────────────

export const MINIMAL_ALLOWLIST = ['PATH', 'HOME', 'LANG', 'TERM', 'TMPDIR'];
export const LOCAL_ALLOWLIST = [...MINIMAL_ALLOWLIST, 'USER', 'SHELL', 'NODE_ENV', 'TZ'];
export const LOCAL_PATTERNS = [/^LC_/];

// ── Env builder ────────────────────────────────────────────────────────

/**
 * Build the env map a node will spawn with. Layers, in order of precedence:
 *
 *   1. MINIMAL_ALLOWLIST / LOCAL_ALLOWLIST from current process.env
 *      (same as v1 per-trust env filter; community agents get MINIMAL)
 *   2. Node's `envAllowlist` adds
 *   3. Node's `env:` YAML field (values with {{inputs.X}} substituted)
 *   4. Node's declared `secrets:` from secretsStore
 *   5. Global variables from variablesStore
 *   6. Resolved agent inputs as env vars (scrubbed of sensitive names)
 *   7. `UPSTREAM_<NODEID>_RESULT` for each declared upstream
 *
 * Later layers win on key collisions. Sensitive names (PATH, NODE_OPTIONS,
 * LD_PRELOAD, etc.) coming from user-supplied inputs are blocked — the
 * schema rejects these at load time but we defense-in-depth here too.
 */
export async function buildNodeEnv(
  agent: Agent,
  node: AgentNode,
  callerInputs: Record<string, string>,
  upstreamSnapshot: Record<string, string>,
  deps: DagExecutorDeps,
): Promise<Record<string, string>> {
  const trustLevel = agent.source === 'community' ? 'community' : 'local';
  const baseAllowlist = trustLevel === 'community' ? MINIMAL_ALLOWLIST : LOCAL_ALLOWLIST;
  const allowed = new Set<string>([...baseAllowlist, ...(node.envAllowlist ?? [])]);
  const env: Record<string, string> = {};

  // 1 + 2: process.env filtered by allowlist.
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (allowed.has(k)) env[k] = v;
    else if (trustLevel === 'local' && LOCAL_PATTERNS.some((re) => re.test(k))) env[k] = v;
  }

  // 3: node's YAML env: — templates substituted.
  if (node.env) {
    for (const [k, v] of Object.entries(node.env)) {
      let resolved = resolveUpstreamTemplate(v, upstreamSnapshot);
      if (deps.variablesStore) resolved = resolveVarsTemplate(resolved, deps.variablesStore.getAll());
      env[k] = substituteInputs(resolved, mergedInputs(agent, callerInputs));
    }
  }

  // 4: secrets. Each node only gets what it declares; never shares across nodes.
  if (node.secrets && node.secrets.length > 0) {
    if (!deps.secretsStore) {
      throw new Error(
        `Node "${node.id}" declares secrets but no secrets store is available. ` +
        `Pass one via DagExecutorDeps.secretsStore.`,
      );
    }
    const all = await deps.secretsStore.getAll();
    const missing: string[] = [];
    for (const name of node.secrets) {
      if (name in all) env[name] = all[name];
      else missing.push(name);
    }
    if (missing.length > 0) {
      throw new Error(`Missing secrets for node "${node.id}": ${missing.join(', ')}. Run 'sua secrets set <name>'.`);
    }
  }

  // 5: global variables. Lower precedence than inputs (step 6).
  if (deps.variablesStore) {
    for (const [k, v] of Object.entries(deps.variablesStore.getAll())) {
      if (SENSITIVE_ENV_NAMES.has(k)) continue;
      env[k] = v;
    }
  }

  // 6: caller-supplied inputs. Drop sensitive names as belt-and-suspenders.
  for (const [k, v] of Object.entries(mergedInputs(agent, callerInputs))) {
    if (SENSITIVE_ENV_NAMES.has(k)) continue;
    env[k] = v;
  }

  // 7: upstream results as UPSTREAM_<NODEID>_RESULT.
  for (const [upstreamId, value] of Object.entries(upstreamSnapshot)) {
    const key = `UPSTREAM_${upstreamId.toUpperCase().replace(/-/g, '_')}_RESULT`;
    env[key] = value;
  }

  return env;
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Compose caller-supplied inputs with agent-level defaults. Missing
 * required inputs throw. Undeclared caller inputs are dropped.
 */
export function mergedInputs(agent: Agent, callerInputs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const specs = agent.inputs ?? {};
  const declared = new Set(Object.keys(specs));

  for (const [name, spec] of Object.entries(specs)) {
    if (name in callerInputs) {
      out[name] = callerInputs[name];
    } else if (spec.default !== undefined) {
      out[name] = String(spec.default);
    } else if (spec.required !== false) {
      throw new Error(`Missing required input "${name}" for agent "${agent.id}"`);
    }
  }

  for (const [k, v] of Object.entries(callerInputs)) {
    if (!declared.has(k)) continue;
    if (!(k in out)) out[k] = v;
  }

  return out;
}

/**
 * Snapshot of upstream node results that feed this node.
 */
export function buildUpstreamSnapshot(node: AgentNode, outputs: Map<string, NodeOutput>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dep of node.dependsOn ?? []) {
    const o = outputs.get(dep);
    if (o) out[dep] = o.result;
  }
  return out;
}

// ── Secret redaction ───────────────────────────────────────────────────

const SENSITIVE_VALUE_PATTERNS = [
  /^ghp_[A-Za-z0-9]{36,}$/,      // GitHub PATs
  /^gho_[A-Za-z0-9]{36,}$/,      // GitHub OAuth tokens
  /^sk-[A-Za-z0-9]{20,}$/,       // OpenAI / Stripe secret keys
  /^xox[bpars]-[A-Za-z0-9-]+$/,  // Slack tokens
  /^AKIA[A-Z0-9]{16}$/,          // AWS access key IDs
  /^eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, // JWTs
];

/**
 * Redact secret values from the env map before persisting to
 * `inputs_json`. Three layers: declared secrets, sensitive names,
 * sensitive value patterns.
 */
export function filterEnvForLog(env: Record<string, string>, node: AgentNode): Record<string, string> {
  const out: Record<string, string> = {};
  const secrets = new Set(node.secrets ?? []);
  for (const [k, v] of Object.entries(env)) {
    if (
      secrets.has(k) ||
      looksLikeSensitive(k) ||
      SENSITIVE_VALUE_PATTERNS.some((re) => re.test(v))
    ) {
      out[k] = '<redacted>';
    } else {
      out[k] = v;
    }
  }
  return out;
}
