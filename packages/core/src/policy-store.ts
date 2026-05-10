/**
 * Tool policies — schema, loader, and a stub enforcement function.
 *
 * PR B of the tool-policies feature ships the file shape + the call seam
 * the executor uses to ask "is this tool call allowed?". The actual
 * allow/deny logic (glob matching, conditions, agent-level overrides)
 * lands in PR C. Today the stub always returns `{effect: 'allow'}` so
 * existing projects keep running without a `.sua/policies.json` file.
 *
 * Why a Zod-validated file rather than a TypeScript module? The policy
 * is operator config, not code. Operators edit it directly or via the
 * forthcoming `sua policy` CLI. A schema gives us coherent error
 * messages when someone hand-edits the file and gets a key wrong, and
 * it's the same validation surface the dashboard's `/settings/policies`
 * editor will reuse.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
 * Evaluate a tool-execute request against the project policy.
 *
 * **PR B stub**: always returns `{effect: 'allow', matchedRuleIndex: -1}`.
 * Wired into the executor seam so PR C can implement real glob matching
 * + condition eval here without touching every dispatch point.
 *
 * **Why a stub instead of skipping the call entirely**: every PR-B-shipped
 * deployment runs through `evaluatePolicy` exactly the way PR C will, so
 * we get telemetry on the call rate, ensure the seam compiles cleanly
 * across providers, and lock in the request/decision shape against
 * existing tests before the engine's behaviour changes.
 */
export function evaluatePolicy(
  _doc: PolicyDocument,
  _request: PolicyEvaluationRequest,
): PolicyDecision {
  return { effect: 'allow', matchedRuleIndex: -1 };
}
