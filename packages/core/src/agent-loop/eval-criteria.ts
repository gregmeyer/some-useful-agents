/**
 * Evaluator for agent-loop success criteria. Reads the just-completed
 * run's per-node executions + the run's structured outputs, checks each
 * declared criterion, returns a structured pass/fail list.
 *
 * Criteria are deliberately narrow: each kind is something we can
 * answer without an LLM call. More elaborate "did the agent satisfy the
 * spirit of this goal?" checks would need a critic-style LLM
 * eval — deferred until we have enough usage data to know what kinds
 * matter.
 */

import { existsSync } from 'node:fs';
import type { AgentSuccessCriterion, NodeExecutionRecord } from '../agent-v2-types.js';
import type { Run } from '../types.js';

export interface CriterionResult {
  /** Stringified description of the criterion that fired, for the failure list / memory. */
  description: string;
  passed: boolean;
  /** When `passed === false`, a short reason for the user / next-iteration prompt. */
  reason?: string;
}

export interface EvaluateCriteriaResult {
  passed: boolean;
  results: CriterionResult[];
}

export interface EvaluateCriteriaInput {
  criteria: AgentSuccessCriterion[];
  run: Run;
  nodeExecutions: NodeExecutionRecord[];
  /**
   * Inputs supplied to the run, for `pathTemplate` expansion in
   * `fileExists`. Optional — when absent, `{{inputs.X}}` templates
   * resolve to empty strings.
   */
  inputs?: Record<string, string>;
}

export function evaluateCriteria(input: EvaluateCriteriaInput): EvaluateCriteriaResult {
  const results: CriterionResult[] = [];
  for (const c of input.criteria) {
    results.push(evalOne(c, input));
  }
  return { passed: results.every((r) => r.passed), results };
}

function evalOne(c: AgentSuccessCriterion, input: EvaluateCriteriaInput): CriterionResult {
  switch (c.kind) {
    case 'shellExitZero':
      return evalShellExitZero(c, input.nodeExecutions);
    case 'fileExists':
      return evalFileExists(c, input.inputs ?? {});
    case 'jsonPathEquals':
      return evalJsonPathEquals(c, input.nodeExecutions);
    case 'regexMatch':
      return evalRegexMatch(c, input.nodeExecutions);
  }
}

function evalShellExitZero(c: Extract<AgentSuccessCriterion, { kind: 'shellExitZero' }>, execs: NodeExecutionRecord[]): CriterionResult {
  const desc = `shellExitZero(${c.nodeId})`;
  const exec = execs.find((e) => e.nodeId === c.nodeId);
  if (!exec) return { description: desc, passed: false, reason: `node "${c.nodeId}" did not run` };
  if (exec.status !== 'completed') return { description: desc, passed: false, reason: `node status was "${exec.status}", not "completed"` };
  if (exec.exitCode === null || exec.exitCode === undefined) {
    return { description: desc, passed: false, reason: 'node has no exit code (not a shell node?)' };
  }
  return exec.exitCode === 0
    ? { description: desc, passed: true }
    : { description: desc, passed: false, reason: `exit code ${exec.exitCode}` };
}

function evalFileExists(c: Extract<AgentSuccessCriterion, { kind: 'fileExists' }>, inputs: Record<string, unknown>): CriterionResult {
  // Minimal template expansion: {{inputs.X}} → inputs[X] stringified.
  // The full template grammar lives in node-templates.ts but is overkill
  // here — criteria are author-edited, so trust them to write simple paths.
  const resolved = c.pathTemplate.replace(/\{\{\s*inputs\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, name: string) => {
    const v = inputs[name];
    return v == null ? '' : String(v);
  });
  const desc = `fileExists(${c.pathTemplate})`;
  if (resolved.length === 0) return { description: desc, passed: false, reason: 'path template expanded to empty string' };
  return existsSync(resolved)
    ? { description: desc, passed: true }
    : { description: desc, passed: false, reason: `path "${resolved}" does not exist` };
}

function evalJsonPathEquals(c: Extract<AgentSuccessCriterion, { kind: 'jsonPathEquals' }>, execs: NodeExecutionRecord[]): CriterionResult {
  const desc = `jsonPathEquals(${c.nodeId}, ${c.path}, ${JSON.stringify(c.equals)})`;
  const exec = execs.find((e) => e.nodeId === c.nodeId);
  if (!exec) return { description: desc, passed: false, reason: `node "${c.nodeId}" did not run` };
  if (!exec.result) return { description: desc, passed: false, reason: `node "${c.nodeId}" produced no result` };
  let parsed: unknown;
  try { parsed = JSON.parse(exec.result); }
  catch { return { description: desc, passed: false, reason: `node "${c.nodeId}" result is not JSON` }; }
  const actual = walkJsonPath(parsed, c.path);
  return deepEqual(actual, c.equals)
    ? { description: desc, passed: true }
    : { description: desc, passed: false, reason: `expected ${JSON.stringify(c.equals)} at ${c.path}, got ${JSON.stringify(actual)}` };
}

function evalRegexMatch(c: Extract<AgentSuccessCriterion, { kind: 'regexMatch' }>, execs: NodeExecutionRecord[]): CriterionResult {
  const desc = `regexMatch(${c.nodeId}, /${c.pattern}/)`;
  const exec = execs.find((e) => e.nodeId === c.nodeId);
  if (!exec) return { description: desc, passed: false, reason: `node "${c.nodeId}" did not run` };
  if (!exec.result) return { description: desc, passed: false, reason: `node "${c.nodeId}" produced no result` };
  let re: RegExp;
  try { re = new RegExp(c.pattern); }
  catch (e) { return { description: desc, passed: false, reason: `invalid regex: ${(e as Error).message}` }; }
  return re.test(exec.result)
    ? { description: desc, passed: true }
    : { description: desc, passed: false, reason: 'regex did not match' };
}

/** Walk a dotted path through a parsed JSON value. `a.b.0.c` works. Returns undefined on miss. */
function walkJsonPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
    } else {
      cur = (cur as Record<string, unknown>)[part];
    }
  }
  return cur;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const aa = a as unknown[], bb = b as unknown[];
    if (aa.length !== bb.length) return false;
    return aa.every((x, i) => deepEqual(x, bb[i]));
  }
  const aKeys = Object.keys(a as object).sort();
  const bKeys = Object.keys(b as object).sort();
  if (aKeys.length !== bKeys.length) return false;
  if (!aKeys.every((k, i) => k === bKeys[i])) return false;
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  return aKeys.every((k) => deepEqual(ao[k], bo[k]));
}

/**
 * Render the failed-criteria list as feedback the next iteration can
 * read. Format mirrors `formatCriticFeedback` from the planner side so
 * the visual convention is consistent across both loop runners.
 */
export function formatCriterionFailures(results: CriterionResult[]): string {
  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) return '';
  const lines: string[] = ['Eval feedback from the previous iteration (fix every item below before re-running):'];
  for (const r of failed) {
    lines.push(`- ${r.description}: ${r.reason ?? 'failed'}`);
  }
  return lines.join('\n');
}
