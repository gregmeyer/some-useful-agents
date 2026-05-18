import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateCriteria, formatCriterionFailures } from './eval-criteria.js';
import type { NodeExecutionRecord } from '../agent-v2-types.js';
import type { Run } from '../types.js';

const dummyRun: Run = {
  id: 'r1',
  agentName: 'test',
  status: 'completed',
  startedAt: '2026-05-18T00:00:00Z',
  triggeredBy: 'cli',
};

const completedShell = (nodeId: string, exitCode: number, result?: string): NodeExecutionRecord => ({
  runId: 'r1',
  nodeId,
  workflowVersion: 1,
  status: 'completed',
  startedAt: '2026-05-18T00:00:00Z',
  completedAt: '2026-05-18T00:00:01Z',
  exitCode,
  result,
});

describe('evaluateCriteria — shellExitZero', () => {
  it('passes when target node exited 0', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'shellExitZero', nodeId: 'a' }],
      run: dummyRun,
      nodeExecutions: [completedShell('a', 0)],
    });
    expect(r.passed).toBe(true);
  });

  it('fails when target node exited non-zero (with reason)', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'shellExitZero', nodeId: 'a' }],
      run: dummyRun,
      nodeExecutions: [completedShell('a', 17)],
    });
    expect(r.passed).toBe(false);
    expect(r.results[0].reason).toContain('17');
  });

  it('fails when target node did not run', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'shellExitZero', nodeId: 'missing' }],
      run: dummyRun,
      nodeExecutions: [completedShell('a', 0)],
    });
    expect(r.passed).toBe(false);
    expect(r.results[0].reason).toContain('did not run');
  });

  it('fails when target node has no exit code (claude-code node)', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'shellExitZero', nodeId: 'a' }],
      run: dummyRun,
      nodeExecutions: [{
        runId: 'r1', nodeId: 'a', workflowVersion: 1,
        status: 'completed', startedAt: '2026-05-18T00:00:00Z',
      }],
    });
    expect(r.passed).toBe(false);
    expect(r.results[0].reason).toContain('no exit code');
  });
});

describe('evaluateCriteria — fileExists', () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'eval-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('passes when the path exists', () => {
    const p = join(dir, 'out.txt');
    writeFileSync(p, 'hello');
    const r = evaluateCriteria({
      criteria: [{ kind: 'fileExists', pathTemplate: p }],
      run: dummyRun,
      nodeExecutions: [],
    });
    expect(r.passed).toBe(true);
  });

  it('expands {{inputs.X}} in the path template', () => {
    const p = join(dir, 'expanded.txt');
    writeFileSync(p, 'x');
    const r = evaluateCriteria({
      criteria: [{ kind: 'fileExists', pathTemplate: `${dir}/{{inputs.NAME}}.txt` }],
      run: dummyRun,
      nodeExecutions: [],
      inputs: { NAME: 'expanded' },
    });
    expect(r.passed).toBe(true);
  });

  it('fails when the path does not exist', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'fileExists', pathTemplate: join(dir, 'nope.txt') }],
      run: dummyRun,
      nodeExecutions: [],
    });
    expect(r.passed).toBe(false);
    expect(r.results[0].reason).toContain('does not exist');
  });

  it('fails when the path template expands to empty', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'fileExists', pathTemplate: '{{inputs.MISSING}}' }],
      run: dummyRun,
      nodeExecutions: [],
      inputs: {},
    });
    expect(r.passed).toBe(false);
    expect(r.results[0].reason).toContain('empty');
  });
});

describe('evaluateCriteria — jsonPathEquals', () => {
  it('passes when the dotted path equals the expected value', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'jsonPathEquals', nodeId: 'a', path: 'count', equals: 3 }],
      run: dummyRun,
      nodeExecutions: [completedShell('a', 0, JSON.stringify({ count: 3 }))],
    });
    expect(r.passed).toBe(true);
  });

  it('walks nested paths including array indices', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'jsonPathEquals', nodeId: 'a', path: 'items.1.name', equals: 'bravo' }],
      run: dummyRun,
      nodeExecutions: [completedShell('a', 0, JSON.stringify({ items: [{ name: 'alpha' }, { name: 'bravo' }] }))],
    });
    expect(r.passed).toBe(true);
  });

  it('fails when the value differs', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'jsonPathEquals', nodeId: 'a', path: 'status', equals: 'ok' }],
      run: dummyRun,
      nodeExecutions: [completedShell('a', 0, JSON.stringify({ status: 'broken' }))],
    });
    expect(r.passed).toBe(false);
    expect(r.results[0].reason).toContain('"broken"');
  });

  it('fails when the result is not JSON', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'jsonPathEquals', nodeId: 'a', path: 'x', equals: 1 }],
      run: dummyRun,
      nodeExecutions: [completedShell('a', 0, 'plain text not json')],
    });
    expect(r.passed).toBe(false);
    expect(r.results[0].reason).toContain('not JSON');
  });

  it('deep-equals objects and arrays', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'jsonPathEquals', nodeId: 'a', path: 'arr', equals: [1, 2, 3] }],
      run: dummyRun,
      nodeExecutions: [completedShell('a', 0, JSON.stringify({ arr: [1, 2, 3] }))],
    });
    expect(r.passed).toBe(true);
  });
});

describe('evaluateCriteria — regexMatch', () => {
  it('passes when the result matches the pattern', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'regexMatch', nodeId: 'a', pattern: 'success' }],
      run: dummyRun,
      nodeExecutions: [completedShell('a', 0, 'OK: success rate 99%')],
    });
    expect(r.passed).toBe(true);
  });

  it('fails when the pattern doesn\'t match', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'regexMatch', nodeId: 'a', pattern: '^error:' }],
      run: dummyRun,
      nodeExecutions: [completedShell('a', 0, 'OK: nothing happened')],
    });
    expect(r.passed).toBe(false);
  });

  it('fails on invalid regex with a clear reason', () => {
    const r = evaluateCriteria({
      criteria: [{ kind: 'regexMatch', nodeId: 'a', pattern: '(unclosed' }],
      run: dummyRun,
      nodeExecutions: [completedShell('a', 0, 'whatever')],
    });
    expect(r.passed).toBe(false);
    expect(r.results[0].reason).toContain('invalid regex');
  });
});

describe('evaluateCriteria — aggregate', () => {
  it('passes only when every criterion passes', () => {
    const r = evaluateCriteria({
      criteria: [
        { kind: 'shellExitZero', nodeId: 'a' },
        { kind: 'regexMatch', nodeId: 'a', pattern: 'ok' },
      ],
      run: dummyRun,
      nodeExecutions: [completedShell('a', 0, 'all ok here')],
    });
    expect(r.passed).toBe(true);
  });

  it('fails the aggregate when any criterion fails', () => {
    const r = evaluateCriteria({
      criteria: [
        { kind: 'shellExitZero', nodeId: 'a' },
        { kind: 'regexMatch', nodeId: 'a', pattern: 'WONT_MATCH' },
      ],
      run: dummyRun,
      nodeExecutions: [completedShell('a', 0, 'all ok')],
    });
    expect(r.passed).toBe(false);
    expect(r.results.filter((x) => !x.passed)).toHaveLength(1);
  });
});

describe('formatCriterionFailures', () => {
  it('returns empty string when nothing failed', () => {
    expect(formatCriterionFailures([
      { description: 'a', passed: true },
    ])).toBe('');
  });

  it('renders each failure with its reason', () => {
    const out = formatCriterionFailures([
      { description: 'shellExitZero(a)', passed: false, reason: 'exit code 7' },
      { description: 'fileExists(/tmp/out)', passed: false, reason: 'does not exist' },
    ]);
    expect(out).toContain('Eval feedback');
    expect(out).toContain('shellExitZero(a): exit code 7');
    expect(out).toContain('fileExists(/tmp/out): does not exist');
  });
});
