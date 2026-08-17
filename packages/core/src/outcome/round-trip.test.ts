/**
 * Round-trip coverage for the `outcome:` block — and for the
 * `successCriteria` / `maxLoopIterations` drop it uncovered.
 *
 * `parsedToAgent` / `AGENT_KEY_ORDER` / `AgentVersionDag` / `extractDag` /
 * `mergeRowWithVersion` are five separate hand-maintained field lists.
 * Missing one silently strips the field on import — the failure mode
 * agent-yaml.ts's own header comment warns about, and the one that made
 * `successCriteria` unreachable in production for its whole life: it
 * validated in YAML, then vanished before the store ever saw it, so
 * `executeAgentLoop` was a permanent pass-through.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent, exportAgent } from '../agent-yaml.js';
import { AgentStore } from '../agent-store.js';
import { agentV2Schema } from '../agent-v2-schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

const YAML = `
id: round-trip
name: Round trip
status: active
source: local
nodes:
  - id: work
    type: shell
    command: echo hi
successCriteria:
  - kind: shellExitZero
    nodeId: work
maxLoopIterations: 3
outcome:
  expected: Something useful was produced.
  assumptions:
    - The input file exists.
  evidence:
    - kind: nodeResult
      nodeId: work
      label: the output
    - kind: runStatus
  success:
    - kind: regexMatch
      nodeId: work
      pattern: hi
  unobservable:
    - whether anyone read it
`;

describe('outcome + successCriteria round-trip', () => {
  it('survives YAML parse', () => {
    const agent = parseAgent(YAML);
    expect(agent.outcome?.expected).toBe('Something useful was produced.');
    expect(agent.outcome?.evidence).toHaveLength(2);
    expect(agent.outcome?.unobservable).toEqual(['whether anyone read it']);
    // The pre-existing drop, now fixed.
    expect(agent.successCriteria).toEqual([{ kind: 'shellExitZero', nodeId: 'work' }]);
    expect(agent.maxLoopIterations).toBe(3);
  });

  it('survives YAML export', () => {
    const yaml = exportAgent(parseAgent(YAML));
    expect(yaml).toContain('outcome:');
    expect(yaml).toContain('successCriteria:');
    expect(yaml).toContain('maxLoopIterations: 3');
    // Re-importing the export must be a fixed point.
    const again = parseAgent(yaml);
    expect(again.outcome).toEqual(parseAgent(YAML).outcome);
    expect(again.successCriteria).toEqual(parseAgent(YAML).successCriteria);
  });

  describe('store', () => {
    let dir: string;
    let store: AgentStore;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'sua-outcome-rt-'));
      store = new AgentStore(join(dir, 'runs.db'));
    });
    afterEach(() => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('survives the versioned DAG snapshot', () => {
      const parsed = parseAgent(YAML);
      store.upsertAgent(parsed, 'import');
      const loaded = store.getAgent('round-trip');

      expect(loaded?.outcome).toEqual(parsed.outcome);
      expect(loaded?.successCriteria).toEqual(parsed.successCriteria);
      expect(loaded?.maxLoopIterations).toBe(3);
    });

    it('treats an outcome change as a version bump', () => {
      const parsed = parseAgent(YAML);
      store.upsertAgent(parsed, 'import');
      const v1 = store.getAgent('round-trip')!.version;

      store.upsertAgent(
        { ...parsed, outcome: { ...parsed.outcome!, expected: 'Something else entirely.' } },
        'import',
      );
      expect(store.getAgent('round-trip')!.version).toBe(v1 + 1);
    });
  });
});

describe('outcome schema validation', () => {
  const base = {
    id: 'x', name: 'X', status: 'active', source: 'local',
    nodes: [{ id: 'work', type: 'shell', command: 'echo hi' }],
  };

  it('rejects an evidence selector pointing at a node that does not exist', () => {
    const result = agentV2Schema.safeParse({
      ...base,
      outcome: { expected: 'x', evidence: [{ kind: 'nodeResult', nodeId: 'ghost' }] },
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toContain('"ghost"');
  });

  // Previously unvalidated: a typo'd criterion nodeId parsed clean and
  // then failed at eval time as `node "typo" did not run`.
  it('rejects a successCriteria nodeId that does not exist', () => {
    const result = agentV2Schema.safeParse({
      ...base,
      successCriteria: [{ kind: 'shellExitZero', nodeId: 'typo' }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toContain('"typo"');
  });

  it('rejects unknown keys in the outcome block', () => {
    const result = agentV2Schema.safeParse({
      ...base,
      outcome: { expected: 'x', evidnce: [] },
    });
    expect(result.success).toBe(false);
  });

  it('accepts an outcome block with only an expectation', () => {
    expect(agentV2Schema.safeParse({ ...base, outcome: { expected: 'x' } }).success).toBe(true);
  });
});

describe('the shipped two-step-digest example', () => {
  it('parses with its outcome block intact', () => {
    const agent = parseAgent(
      readFileSync(join(REPO_ROOT, 'agents', 'examples', 'two-step-digest.yaml'), 'utf8'),
    );
    expect(agent.outcome?.evidence).toHaveLength(4);
    expect(agent.outcome?.success).toHaveLength(2);
    // Observation only: adding `outcome:` must not opt the agent into the
    // re-run control loop.
    expect(agent.successCriteria).toBeUndefined();
  });
});
