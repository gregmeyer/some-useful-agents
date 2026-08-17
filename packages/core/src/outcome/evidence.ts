/**
 * Evidence collection — the deterministic half of OutcomeDetection.
 *
 * Pure, LLM-free, and side-effect-free apart from reading the filesystem
 * for `file` selectors. Given the declared selectors plus the run's
 * persisted state, it produces a bundle of provenance-tagged items.
 *
 * Two properties matter more than anything else here:
 *
 *  1. A selector that resolves to nothing produces an `absent` item rather
 *     than disappearing. "We looked for the digest file and it wasn't
 *     there" is the evidence that makes non-achievement detectable; a
 *     detector that silently drops misses can only ever report success.
 *
 *  2. Values are redacted before they leave this function. The local DAG
 *     executor writes RAW stdout to `node_executions.result` —
 *     `redactKnownSecrets` is applied on the v1 chain path and the Temporal
 *     activity, but never in `dag-executor.ts`. Since evidence values get
 *     shipped to a judge and written to a separate table, redaction has to
 *     happen here, unconditionally.
 */

import { existsSync, statSync, readFileSync } from 'node:fs';
import type { NodeExecutionRecord } from '../agent-v2-types.js';
import type { Run } from '../types.js';
import { redactKnownSecrets } from '../secret-redactor.js';
import type { EvidenceItem, EvidenceSelector } from './types.js';

/** Per-item value cap. Long enough to be useful, short enough to bound a judge prompt. */
export const MAX_EVIDENCE_VALUE_CHARS = 2000;
/** Hard cap on bundle size, so a 200-node DAG can't produce an unbounded prompt. */
export const MAX_EVIDENCE_ITEMS = 50;
/** Files above this are described, not read. */
const MAX_FILE_PREVIEW_BYTES = 64 * 1024;

export interface CollectEvidenceInput {
  selectors: EvidenceSelector[];
  run: Run;
  nodeExecutions: NodeExecutionRecord[];
  /** Inputs supplied to the run, for `{{inputs.X}}` expansion in `file` paths. */
  inputs?: Record<string, string>;
  /** Agent state dir, for `{{state}}` expansion. Absent → `{{state}}` is a miss. */
  stateDir?: string;
  /** Injectable clock so records are reproducible in tests. */
  now?: () => Date;
}

export function collectEvidence(input: CollectEvidenceInput): EvidenceItem[] {
  const capturedAt = (input.now?.() ?? new Date()).toISOString();
  const items: EvidenceItem[] = [];
  let seq = 0;
  const nextId = () => `ev${++seq}`;

  for (const selector of input.selectors.slice(0, MAX_EVIDENCE_ITEMS)) {
    items.push(resolveSelector(selector, input, nextId(), capturedAt));
  }
  return items;
}

function resolveSelector(
  selector: EvidenceSelector,
  input: CollectEvidenceInput,
  id: string,
  capturedAt: string,
): EvidenceItem {
  const runId = input.run.id;
  const base = { id, label: selector.label, capturedAt };

  switch (selector.kind) {
    case 'runStatus': {
      const value = JSON.stringify({
        status: input.run.status,
        exitCode: input.run.exitCode ?? null,
        error: input.run.error ?? null,
      });
      return {
        ...base,
        kind: 'run-status',
        source: { runId, selector: 'runStatus' },
        ...capValue(value),
      };
    }

    case 'nodeStatus': {
      const exec = findExec(input.nodeExecutions, selector.nodeId);
      if (!exec) {
        return absent(base, { runId, nodeId: selector.nodeId, selector: 'nodeStatus' },
          `node "${selector.nodeId}" has no execution record in this run`);
      }
      const value = JSON.stringify({
        status: exec.status,
        exitCode: exec.exitCode ?? null,
        errorCategory: exec.errorCategory ?? null,
        error: exec.error ?? null,
      });
      return {
        ...base,
        kind: 'node-status',
        source: { runId, nodeId: selector.nodeId, selector: 'nodeStatus' },
        ...capValue(value),
      };
    }

    case 'nodeResult': {
      const exec = findExec(input.nodeExecutions, selector.nodeId);
      if (!exec) {
        return absent(base, { runId, nodeId: selector.nodeId, selector: 'nodeResult' },
          `node "${selector.nodeId}" has no execution record in this run`);
      }
      if (exec.result === undefined || exec.result === null || exec.result === '') {
        return absent(base, { runId, nodeId: selector.nodeId, selector: 'nodeResult' },
          `node "${selector.nodeId}" produced no result (status: ${exec.status})`);
      }
      return {
        ...base,
        kind: 'node-result',
        source: { runId, nodeId: selector.nodeId, selector: 'nodeResult' },
        ...capValue(exec.result),
      };
    }

    case 'nodeOutputField': {
      const exec = findExec(input.nodeExecutions, selector.nodeId);
      const source = { runId, nodeId: selector.nodeId, field: selector.field, selector: 'nodeOutputField' as const };
      if (!exec) {
        return absent(base, source, `node "${selector.nodeId}" has no execution record in this run`);
      }
      if (!exec.outputsJson) {
        return absent(base, source,
          `node "${selector.nodeId}" produced no structured output (nothing JSON-parseable on its last stdout line)`);
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(exec.outputsJson) as Record<string, unknown>;
      } catch {
        return absent(base, source, `node "${selector.nodeId}" outputsJson is not parseable`);
      }
      if (!(selector.field in parsed)) {
        return absent(base, source,
          `field "${selector.field}" is not present in node "${selector.nodeId}" output (has: ${Object.keys(parsed).join(', ') || 'nothing'})`);
      }
      const raw = parsed[selector.field];
      const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
      return { ...base, kind: 'node-output-field', source, ...capValue(value ?? 'null') };
    }

    case 'file': {
      const resolved = expandPath(selector.pathTemplate, input.inputs ?? {}, input.stateDir);
      const source = { runId, path: resolved, selector: 'file' as const };
      if (resolved.length === 0) {
        return absent(base, { runId, path: selector.pathTemplate, selector: 'file' },
          `path template "${selector.pathTemplate}" expanded to an empty string`);
      }
      if (!existsSync(resolved)) {
        return absent(base, source, `path "${resolved}" does not exist`);
      }
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(resolved);
      } catch (err) {
        return absent(base, source, `path "${resolved}" could not be stat'ed: ${(err as Error).message}`);
      }
      if (stat.isDirectory()) {
        return { ...base, kind: 'file', source, ...capValue(`<directory, ${stat.size} bytes>`) };
      }
      if (stat.size > MAX_FILE_PREVIEW_BYTES) {
        return { ...base, kind: 'file', source, ...capValue(`<file exists, ${stat.size} bytes — too large to preview>`) };
      }
      let text: string;
      try {
        text = readFileSync(resolved, 'utf8');
      } catch {
        return { ...base, kind: 'file', source, ...capValue(`<file exists, ${stat.size} bytes — not readable as utf-8 text>`) };
      }
      return { ...base, kind: 'file', source, ...capValue(text) };
    }
  }
}

function findExec(execs: NodeExecutionRecord[], nodeId: string): NodeExecutionRecord | undefined {
  return execs.find((e) => e.nodeId === nodeId);
}

function absent(
  base: { id: string; label?: string; capturedAt: string },
  source: EvidenceItem['source'],
  detail: string,
): EvidenceItem {
  // The `detail` goes in `value` on purpose: for an absent item, the
  // description of what was looked for and not found IS the evidence.
  return { ...base, kind: 'absent', source, value: detail, truncated: false };
}

function capValue(raw: string): { value: string; truncated: boolean } {
  const redacted = redactKnownSecrets(raw);
  if (redacted.length <= MAX_EVIDENCE_VALUE_CHARS) {
    return { value: redacted, truncated: false };
  }
  return {
    value: `${redacted.slice(0, MAX_EVIDENCE_VALUE_CHARS)}…[truncated ${redacted.length - MAX_EVIDENCE_VALUE_CHARS} chars]`,
    truncated: true,
  };
}

/**
 * Minimal template expansion for `file` selectors: `{{inputs.X}}` and
 * `{{state}}`. Deliberately the same narrow grammar `eval-criteria`'s
 * `fileExists` uses — the full template engine in node-templates.ts is
 * overkill for author-written paths, and matching the existing behaviour
 * means one thing to learn.
 */
export function expandPath(
  template: string,
  inputs: Record<string, unknown>,
  stateDir?: string,
): string {
  return template
    .replace(/\{\{\s*inputs\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, name: string) => {
      const v = inputs[name];
      return v == null ? '' : String(v);
    })
    .replace(/\{\{\s*state\s*\}\}/g, stateDir ?? '');
}
