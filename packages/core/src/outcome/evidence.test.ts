import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NodeExecutionRecord } from '../agent-v2-types.js';
import type { Run } from '../types.js';
import { collectEvidence, expandPath, MAX_EVIDENCE_VALUE_CHARS } from './evidence.js';

const FIXED_NOW = () => new Date('2026-08-15T12:00:00.000Z');

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    agentName: 'demo',
    status: 'completed',
    startedAt: '2026-08-15T11:59:00.000Z',
    completedAt: '2026-08-15T12:00:00.000Z',
    triggeredBy: 'cli',
    ...overrides,
  } as Run;
}

function exec(overrides: Partial<NodeExecutionRecord> & { nodeId: string }): NodeExecutionRecord {
  return {
    runId: 'run-1',
    workflowVersion: 1,
    status: 'completed',
    startedAt: '2026-08-15T11:59:00.000Z',
    ...overrides,
  } as NodeExecutionRecord;
}

describe('collectEvidence', () => {
  it('captures a node result with a resolvable provenance pointer', () => {
    const items = collectEvidence({
      selectors: [{ kind: 'nodeResult', nodeId: 'summarise', label: 'digest' }],
      run: run(),
      nodeExecutions: [exec({ nodeId: 'summarise', result: '10 headlines loaded.' })],
      now: FIXED_NOW,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'ev1',
      kind: 'node-result',
      label: 'digest',
      value: '10 headlines loaded.',
      truncated: false,
      source: { runId: 'run-1', nodeId: 'summarise', selector: 'nodeResult' },
    });
  });

  it('reads a field out of structured output', () => {
    const items = collectEvidence({
      selectors: [{ kind: 'nodeOutputField', nodeId: 'fetch', field: 'bytes' }],
      run: run(),
      nodeExecutions: [exec({ nodeId: 'fetch', outputsJson: JSON.stringify({ bytes: 940, result: 'x' }) })],
      now: FIXED_NOW,
    });
    expect(items[0].kind).toBe('node-output-field');
    expect(items[0].value).toBe('940');
    expect(items[0].source.field).toBe('bytes');
  });

  // The single most important behaviour in this file. A selector that
  // resolves to nothing must leave a mark; a detector that silently drops
  // misses can only ever report success.
  describe('absent evidence', () => {
    it('emits an absent item when the node never ran', () => {
      const items = collectEvidence({
        selectors: [{ kind: 'nodeResult', nodeId: 'ghost' }],
        run: run(),
        nodeExecutions: [],
        now: FIXED_NOW,
      });
      expect(items[0].kind).toBe('absent');
      expect(items[0].value).toContain('no execution record');
      expect(items[0].source.nodeId).toBe('ghost');
    });

    it('emits an absent item when the node ran but produced nothing', () => {
      const items = collectEvidence({
        selectors: [{ kind: 'nodeResult', nodeId: 'fetch' }],
        run: run({ status: 'failed' }),
        nodeExecutions: [exec({ nodeId: 'fetch', status: 'failed', result: '', errorCategory: 'exit_nonzero' })],
        now: FIXED_NOW,
      });
      expect(items[0].kind).toBe('absent');
      expect(items[0].value).toContain('produced no result');
      expect(items[0].value).toContain('failed');
    });

    it('names the fields that WERE present when the requested one is missing', () => {
      const items = collectEvidence({
        selectors: [{ kind: 'nodeOutputField', nodeId: 'fetch', field: 'row_count' }],
        run: run(),
        nodeExecutions: [exec({ nodeId: 'fetch', outputsJson: JSON.stringify({ bytes: 12, content: 'x' }) })],
        now: FIXED_NOW,
      });
      expect(items[0].kind).toBe('absent');
      expect(items[0].value).toContain('bytes, content');
    });

    it('emits an absent item for a missing file rather than throwing', () => {
      const items = collectEvidence({
        selectors: [{ kind: 'file', pathTemplate: '/nope/definitely/not/here.txt' }],
        run: run(),
        nodeExecutions: [],
        now: FIXED_NOW,
      });
      expect(items[0].kind).toBe('absent');
      expect(items[0].value).toContain('does not exist');
    });
  });

  describe('files', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sua-outcome-ev-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('previews a text file that exists', () => {
      writeFileSync(join(dir, 'digest.txt'), 'hello digest');
      const items = collectEvidence({
        selectors: [{ kind: 'file', pathTemplate: '{{state}}/digest.txt' }],
        run: run(),
        nodeExecutions: [],
        stateDir: dir,
        now: FIXED_NOW,
      });
      expect(items[0].kind).toBe('file');
      expect(items[0].value).toBe('hello digest');
      expect(items[0].source.path).toBe(join(dir, 'digest.txt'));
    });

    it('describes a directory without reading it', () => {
      mkdirSync(join(dir, 'out'));
      const items = collectEvidence({
        selectors: [{ kind: 'file', pathTemplate: join(dir, 'out') }],
        run: run(),
        nodeExecutions: [],
        now: FIXED_NOW,
      });
      expect(items[0].kind).toBe('file');
      expect(items[0].value).toContain('<directory');
    });
  });

  // The local DAG executor writes RAW stdout to node_executions.result —
  // redactKnownSecrets is never applied on that path. Evidence values get
  // shipped to a judge and written to a second table, so this is the last
  // line of defence.
  it('redacts known secrets before the value leaves the collector', () => {
    // Assembled at runtime, never written as one literal: gitleaks matches a
    // contiguous `ghp_` + 36 chars, so a hard-coded fixture trips the scanner
    // on every commit that touches this file. .gitleaks.toml's authoring note
    // asks for exactly this over widening the path allowlist — allowlisting
    // the file would also stop a REAL secret here from ever being caught.
    // The redactor still sees a fully-formed token at run time.
    const fakePat = `ghp_${'abcdefghijklmnopqrstuvwxyz0123456789'}`;
    const leak = `deploy ok, token=${fakePat} done`;
    const items = collectEvidence({
      selectors: [{ kind: 'nodeResult', nodeId: 'deploy' }],
      run: run(),
      nodeExecutions: [exec({ nodeId: 'deploy', result: leak })],
      now: FIXED_NOW,
    });
    expect(items[0].value).toContain('[REDACTED:GITHUB_PAT]');
    expect(items[0].value).not.toContain(fakePat);
  });

  it('truncates oversized values and says so', () => {
    const items = collectEvidence({
      selectors: [{ kind: 'nodeResult', nodeId: 'big' }],
      run: run(),
      nodeExecutions: [exec({ nodeId: 'big', result: 'x'.repeat(MAX_EVIDENCE_VALUE_CHARS + 500) })],
      now: FIXED_NOW,
    });
    expect(items[0].truncated).toBe(true);
    expect(items[0].value).toContain('[truncated 500 chars]');
  });

  it('assigns stable sequential ids in selector order', () => {
    const items = collectEvidence({
      selectors: [
        { kind: 'runStatus' },
        { kind: 'nodeStatus', nodeId: 'a' },
        { kind: 'nodeResult', nodeId: 'a' },
      ],
      run: run(),
      nodeExecutions: [exec({ nodeId: 'a', result: 'ok', exitCode: 0 })],
      now: FIXED_NOW,
    });
    expect(items.map((i) => i.id)).toEqual(['ev1', 'ev2', 'ev3']);
    expect(items.map((i) => i.kind)).toEqual(['run-status', 'node-status', 'node-result']);
  });
});

describe('expandPath', () => {
  it('expands {{inputs.X}} and {{state}}', () => {
    expect(expandPath('{{state}}/out/{{inputs.NAME}}.txt', { NAME: 'greg' }, '/data/st')).toBe('/data/st/out/greg.txt');
  });

  it('expands an unknown input to an empty string rather than leaving the template', () => {
    expect(expandPath('/tmp/{{inputs.MISSING}}', {})).toBe('/tmp/');
  });
});
