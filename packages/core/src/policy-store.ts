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

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
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

// ── Writing (the dashboard's rules editor) ─────────────────────────────

/** The file changed between reading it and saving over it. */
export class PolicyConflictError extends Error {
  constructor(public readonly path: string) {
    super(`${path} changed since you opened it (someone or something else edited it). Reload to see the current rules, then make your change again.`);
    this.name = 'PolicyConflictError';
  }
}

/**
 * A short fingerprint of the policy file as it is on disk ('' when there is
 * no file). An editor reads it with the rules and sends it back with a save,
 * so a save never silently overwrites an edit made in between.
 */
export function policyFileVersion(dataDir: string): string {
  const path = policyFilePath(dataDir);
  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); } catch { return ''; }
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/** The raw file text ('' when there is none), for the JSON editor. */
export function readPolicyFileText(dataDir: string): string {
  try { return readFileSync(policyFilePath(dataDir), 'utf-8'); } catch { return ''; }
}

/**
 * The document as it's written: defaults left out (action "execute", empty
 * resources, empty conditions), so a saved file reads like a hand-written one.
 */
export function serializePolicyDocument(doc: PolicyDocument): string {
  const rules = doc.rules.map((r) => {
    const out: Record<string, unknown> = { tool: r.tool };
    if (r.action !== 'execute') out.action = r.action;
    if (r.resources.length > 0) out.resources = r.resources;
    out.effect = r.effect;
    if (r.conditions?.source?.length) out.conditions = { source: r.conditions.source };
    if (r.reason) out.reason = r.reason;
    return out;
  });
  return `${JSON.stringify({ version: 1, defaultAction: doc.defaultAction, rules }, null, 2)}\n`;
}

/**
 * Write the policy file: validate first (an invalid document is never
 * written, so the editor can't produce a file that blocks everything),
 * refuse when the file changed since `expectedVersion` was read, keep the
 * previous contents as `policies.json.bak` (for Undo), and replace the file
 * atomically. Returns the new version. Takes effect on the next tool call
 * (the resolver re-reads on mtime change).
 */
export function savePolicyDocument(
  dataDir: string,
  input: unknown,
  opts: { expectedVersion?: string } = {},
): { version: string; doc: PolicyDocument } {
  const result = policyDocumentSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new PolicyLoadError(`Not saved, the policy is invalid: ${issues}`, policyFilePath(dataDir));
  }
  writePolicyText(dataDir, serializePolicyDocument(result.data), opts.expectedVersion);
  return { version: policyFileVersion(dataDir), doc: result.data };
}

/**
 * Save raw JSON text (the JSON editor). Must parse and validate; the text is
 * written as given so the author's formatting is kept.
 */
export function savePolicyText(dataDir: string, text: string, opts: { expectedVersion?: string } = {}): { version: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (e) {
    throw new PolicyLoadError(`Not saved, that isn't valid JSON: ${(e as Error).message}`, policyFilePath(dataDir));
  }
  const result = policyDocumentSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new PolicyLoadError(`Not saved, the policy is invalid: ${issues}`, policyFilePath(dataDir));
  }
  writePolicyText(dataDir, text.endsWith('\n') ? text : `${text}\n`, opts.expectedVersion);
  return { version: policyFileVersion(dataDir) };
}

/** Whether there is a previous version to go back to. */
export function hasPolicyBackup(dataDir: string): boolean {
  return existsSync(`${policyFilePath(dataDir)}.bak`);
}

/**
 * Undo the last save: put `policies.json.bak` back (the current file becomes
 * the new .bak, so Undo twice is Redo). Same conflict check as a save. The
 * backup is restored even if it no longer validates — it was the file before.
 */
export function restorePolicyBackup(dataDir: string, opts: { expectedVersion?: string } = {}): { version: string } {
  const path = policyFilePath(dataDir);
  const backup = `${path}.bak`;
  if (!existsSync(backup)) throw new PolicyLoadError('There is no earlier version to go back to.', path);
  writePolicyText(dataDir, readFileSync(backup, 'utf-8'), opts.expectedVersion);
  return { version: policyFileVersion(dataDir) };
}

function writePolicyText(dataDir: string, text: string, expectedVersion: string | undefined): void {
  const path = policyFilePath(dataDir);
  if (expectedVersion !== undefined && expectedVersion !== policyFileVersion(dataDir)) {
    throw new PolicyConflictError(path);
  }
  mkdirSync(dirname(path), { recursive: true });
  const previous = readPolicyFileText(dataDir);
  if (existsSync(path)) writeFileSync(`${path}.bak`, previous, { mode: 0o600 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
  policyCache.delete(path);
}
