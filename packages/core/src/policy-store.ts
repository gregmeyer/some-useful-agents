/**
 * Tool policies — schema, loader, and enforcement.
 *
 * Every sua tool call asks `evaluatePolicy` first: DAG tool nodes (the
 * executor seam) and every tool a model calls, on any provider (the shared
 * `buildToolExecutor`, which the HTTP tool loop and claude's MCP endpoint
 * both use). Rules live in `<dataDir>/.sua/policies.json`; the last matching
 * rule decides, else `defaultAction`. A missing file allows everything; an
 * invalid one blocks every tool call until it's fixed (fail closed). See
 * docs/tool-policies.md.
 *
 * Why a Zod-validated file rather than a TypeScript module? The policy
 * is operator config, not code. Operators edit it directly or via the
 * forthcoming `sua policy` CLI. A schema gives us coherent error
 * messages when someone hand-edits the file and gets a key wrong, and
 * it's the same validation surface the dashboard's `/settings/policies`
 * editor will reuse.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

/**
 * Authoritative on-disk schema for `.sua/policies.json`.
 *
 * `version` exists so future format breaks (e.g., conditions DSL changes
 * in PR D+) can be migrated by `sua policy migrate` rather than rejecting
 * old files.
 *
 * `defaultAction` is `allow` by default to match the v0.16 posture
 * (everything runs unless explicitly denied) — switching to deny-by-default
 * would force every project to enumerate an allowlist before anything
 * works, which we'd want behind a `sua doctor --strict` flag, not as the
 * default. See `~/.claude/plans/tool-policies.md` § Open questions.
 */
export const policyRuleSchema = z.object({
  /** Tool id this rule applies to. `*` matches every tool. */
  tool: z.string().min(1),
  /**
   * What operation to gate. Today the only meaningful value is `execute`;
   * future writable-resource APIs (file-write open/close, http-post body
   * inspection) may add more.
   */
  action: z.enum(['execute']).default('execute'),
  /**
   * Glob patterns matched against the tool's primary input — `url` for
   * http tools, `path` for file tools, `command` for shell-exec, etc.
   * `*` matches anything. Empty array == applies to every resource.
   */
  resources: z.array(z.string()).default([]),
  /** `allow` overrides any earlier `deny`; `deny` overrides any earlier `allow`. */
  effect: z.enum(['allow', 'deny']),
  /**
   * Optional gating conditions evaluated against the *agent* invoking the
   * tool. Today only `source` is wired; PR C/D may add `node-id`, `tag`,
   * and `created-by` filters as the need surfaces.
   */
  conditions: z.object({
    source: z.array(z.enum(['examples', 'local', 'community'])).optional(),
  }).optional(),
  /**
   * Operator-authored explanation. Surfaced in the dashboard run-detail
   * page when the policy denies a node, and in `sua policy check`
   * output, so debugging is a lookup instead of a code-trace.
   */
  reason: z.string().optional(),
});

export const policyDocumentSchema = z.object({
  version: z.literal(1),
  defaultAction: z.enum(['allow', 'deny']).default('allow'),
  rules: z.array(policyRuleSchema).default([]),
});

export type PolicyRule = z.infer<typeof policyRuleSchema>;
export type PolicyDocument = z.infer<typeof policyDocumentSchema>;

/**
 * The default in-memory policy document used when no `.sua/policies.json`
 * exists. Allow-by-default with no rules — same posture every existing
 * project has today.
 */
export const DEFAULT_POLICY_DOCUMENT: PolicyDocument = {
  version: 1,
  defaultAction: 'allow',
  rules: [],
};

/**
 * Resolve the on-disk path for a project's policy file. Centralised so
 * both the loader and the future `sua policy add/remove` writers agree.
 */
export function policyFilePath(dataDir: string): string {
  return join(dataDir, '.sua', 'policies.json');
}

/**
 * Load the project policy document. Returns the default (allow-all)
 * document when no file exists, so callers don't need to handle a null.
 *
 * On parse / schema failure we throw `PolicyLoadError` instead of falling
 * back silently — a malformed policy file is a configuration bug the
 * operator needs to fix, not a permissive surprise. The error includes
 * the path so the CLI can surface it cleanly.
 */
export function loadPolicyDocument(dataDir: string): PolicyDocument {
  const path = policyFilePath(dataDir);
  if (!existsSync(path)) return DEFAULT_POLICY_DOCUMENT;

  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); }
  catch (e) { throw new PolicyLoadError(`Cannot read ${path}: ${(e as Error).message}`, path); }

  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new PolicyLoadError(`Invalid JSON in ${path}: ${(e as Error).message}`, path); }

  const result = policyDocumentSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new PolicyLoadError(`Policy schema validation failed at ${path}: ${issues}`, path);
  }
  return result.data;
}

export class PolicyLoadError extends Error {
  constructor(message: string, public readonly path: string) {
    super(message);
    this.name = 'PolicyLoadError';
  }
}

/**
 * Thrown by the executor's tool-dispatch path when the policy engine
 * denies a tool call. The dag-executor catches this specifically and
 * categorises the failed node as `policy_denied` so dashboards can
 * distinguish "policy refused this" from "the tool itself errored."
 *
 * Carries the rule index that decided so `sua policy check` and the
 * dashboard error surface can link to the rule.
 */
export class PolicyDeniedError extends Error {
  constructor(
    message: string,
    public readonly toolId: string,
    public readonly resource: string,
    public readonly matchedRuleIndex?: number,
  ) {
    super(message);
    this.name = 'PolicyDeniedError';
  }
}

/**
 * Request shape evaluated against the policy. Built by the executor at
 * tool-dispatch time. PR C grows the actual matching logic; PR B's stub
 * doesn't read most of these fields, but they're the contract callers
 * commit to so PR C can drop in without changing dispatch.
 */
export interface PolicyEvaluationRequest {
  /** Tool id (`http-get`, `shell-exec`, an MCP tool id, etc.). */
  toolId: string;
  /**
   * Primary resource the tool would touch — extracted from the resolved
   * tool inputs (e.g. the `url` field for http tools, `path` for
   * file tools, `command` for shell-exec). Empty string when the tool
   * has no obvious primary resource.
   */
  resource: string;
  /** Source tier of the agent invoking the tool. */
  agentSource: 'examples' | 'local' | 'community';
  /** Agent id, for telemetry / per-agent overrides. */
  agentId: string;
}

export interface PolicyDecision {
  effect: 'allow' | 'deny';
  /** Populated on `deny` so the executor can surface a useful error. */
  reason?: string;
  /** Index into `doc.rules` of the rule that decided, or -1 for default. */
  matchedRuleIndex?: number;
}

/**
 * A policy document as enforced. `invalidReason` is set only on the
 * fail-closed stand-in `resolvePolicyDocument` returns for a broken file:
 * every request is denied with that reason.
 */
export type EnforcedPolicy = PolicyDocument & { invalidReason?: string };

/**
 * Glob → anchored RegExp. `*` matches any run of characters INCLUDING `/`
 * (so URL and path patterns read naturally: `https://api.github.com/*`,
 * `/Users/me/project/out/*`), `?` matches one character, everything else is literal.
 * Case-sensitive.
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (const ch of glob) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 's');
}

function ruleMatches(rule: PolicyRule, req: PolicyEvaluationRequest): boolean {
  if (rule.tool !== '*' && !globToRegExp(rule.tool).test(req.toolId)) return false;
  if (rule.resources.length > 0) {
    // An unknown resource only matches `*`: a URL-scoped allow must not be
    // satisfied by a call that has no URL to check.
    const hit = rule.resources.some((g) => (req.resource === '' ? g === '*' : globToRegExp(g).test(req.resource)));
    if (!hit) return false;
  }
  if (rule.conditions?.source && !rule.conditions.source.includes(req.agentSource)) return false;
  return true;
}

/**
 * Evaluate a tool-execute request against the project policy. Rules are
 * read in order and the LAST one that matches decides (a later rule
 * overrides an earlier one, so a broad deny can be followed by narrow
 * allows, or the reverse). No match ⇒ `defaultAction`.
 */
export function evaluatePolicy(
  doc: EnforcedPolicy,
  request: PolicyEvaluationRequest,
): PolicyDecision {
  if (doc.invalidReason) return { effect: 'deny', reason: doc.invalidReason, matchedRuleIndex: -1 };

  let decidingIndex = -1;
  doc.rules.forEach((rule, i) => { if (ruleMatches(rule, request)) decidingIndex = i; });

  const on = request.resource ? ` on "${request.resource}"` : '';
  if (decidingIndex >= 0) {
    const rule = doc.rules[decidingIndex];
    return {
      effect: rule.effect,
      matchedRuleIndex: decidingIndex,
      reason: rule.reason ?? (rule.effect === 'deny' ? `Policy rule #${decidingIndex} denies "${request.toolId}"${on}.` : undefined),
    };
  }
  return {
    effect: doc.defaultAction,
    matchedRuleIndex: -1,
    reason: doc.defaultAction === 'deny' ? `No policy rule allows "${request.toolId}"${on}, and the default action is deny.` : undefined,
  };
}

/**
 * The resource a tool call touches, from its RESOLVED arguments: the URL for
 * web/http tools, the absolute path for file tools (resolved the way the
 * tools themselves resolve it), the command for shell-exec. Empty when the
 * tool has no primary resource. The one extractor every call site uses.
 */
export function policyResource(toolId: string, args: Record<string, unknown>, workingDirectory?: string): string {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  switch (toolId) {
    case 'http-get':
    case 'http-post':
    case 'web-fetch':
    case 'web-scrape':
      return str(args.url) || str(args.endpoint);
    case 'file-read':
    case 'file-write': {
      const p = str(args.path);
      if (!p) return '';
      return isAbsolute(p) ? p : resolve(workingDirectory ?? process.cwd(), p);
    }
    case 'shell-exec':
      return str(args.command);
    default:
      return '';
  }
}

const policyCache = new Map<string, { mtimeMs: number; doc: EnforcedPolicy }>();

/**
 * The policy to enforce for a data dir. Re-reads only when the file changes
 * (mtime), so an edit applies to the next tool call without a restart.
 * Missing file ⇒ the allow-all default. Invalid file ⇒ fail CLOSED: a
 * document that denies every call with the load error as the reason — a
 * typo in a deny rule must never quietly become allow-all.
 */
export function resolvePolicyDocument(dataDir: string): EnforcedPolicy {
  const path = policyFilePath(dataDir);
  let mtimeMs: number;
  try { mtimeMs = statSync(path).mtimeMs; } catch { policyCache.delete(path); return DEFAULT_POLICY_DOCUMENT; }
  const cached = policyCache.get(path);
  if (cached && cached.mtimeMs === mtimeMs) return cached.doc;
  let doc: EnforcedPolicy;
  try {
    doc = loadPolicyDocument(dataDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    doc = {
      ...DEFAULT_POLICY_DOCUMENT,
      defaultAction: 'deny',
      invalidReason: `${message} — every tool call is blocked until the policy file is fixed (sua policy validate).`,
    };
  }
  policyCache.set(path, { mtimeMs, doc });
  return doc;
}
