/**
 * End-to-end proof harness for OutcomeDetection.
 *
 * Runs the SHIPPED `two-step-digest` example agent for real — no canned
 * spawner, no mocked tools — across four scenarios, and detects an outcome
 * for each. `two-step-digest` was chosen because it is a genuine two-node
 * DAG (builtin `file-read` tool → shell node consuming
 * `$UPSTREAM_FETCH_RESULT`) that needs no LLM, no network, and no
 * credentials, so the proof is reproducible on any machine.
 *
 * Each scenario copies the shipped headline fixture into a temp directory
 * and points the agent at it, so nothing depends on the process working
 * directory and nothing writes into the repo.
 *
 * Consumed by `e2e.test.ts` (asserts invariants) and, with
 * SUA_WRITE_OUTCOME_FIXTURE=1, by the same test to regenerate the
 * committed `records.jsonl` artifact.
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent } from '../../agent-yaml.js';
import { RunStore } from '../../run-store.js';
import { executeAgentDag } from '../../dag-executor.js';
import { detectOutcome } from '../detect.js';
import type { Agent } from '../../agent-v2-types.js';
import type { OutcomeExpectation, OutcomeRecord } from '../types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..', '..');
const AGENT_YAML = join(REPO_ROOT, 'agents', 'examples', 'two-step-digest.yaml');
const HEADLINES_JSON = join(REPO_ROOT, 'agents', 'examples', 'data', 'sample-headlines.json');

export type ScenarioName = 'happy' | 'empty-source' | 'missing-source' | 'unobservable';

export interface ScenarioSpec {
  name: ScenarioName;
  /** Plain-English description of what this run is meant to demonstrate. */
  describes: string;
  /** Ground truth for the self-eval — what a trustworthy detector should conclude. */
  groundTruth: {
    satisfied: OutcomeRecord['evaluation']['satisfied'];
    /** Evidence kinds a detector MUST surface to have understood this run. */
    mustSurfaceEvidenceKinds: string[];
    /** Unknown reasons that MUST appear. */
    mustFlagUnknownReasons: string[];
  };
}

/**
 * 12 runs. Weighted toward the happy path, because a detector that only
 * ever sees failures is as untrustworthy as one that only sees successes —
 * but three of the four scenarios are non-success on purpose.
 */
export const SCENARIO_PLAN: ScenarioName[] = [
  'happy', 'happy', 'happy', 'happy', 'happy', 'happy',
  'empty-source', 'empty-source',
  'missing-source', 'missing-source',
  'unobservable', 'unobservable',
];

export const SCENARIOS: Record<ScenarioName, ScenarioSpec> = {
  happy: {
    name: 'happy',
    describes: 'Source file present with 10 headlines. The digest is produced as intended.',
    groundTruth: {
      satisfied: 'yes',
      mustSurfaceEvidenceKinds: ['node-result', 'node-output-field'],
      mustFlagUnknownReasons: ['not-inferred'],
    },
  },
  'empty-source': {
    name: 'empty-source',
    describes:
      'Source file present but contains zero headlines. Every node exits 0 and the run '
      + 'reports success — but the digest is empty, so the outcome was only partly reached. '
      + 'This is the case that proves run status is not outcome status.',
    groundTruth: {
      satisfied: 'partial',
      mustSurfaceEvidenceKinds: ['node-result'],
      mustFlagUnknownReasons: ['not-inferred'],
    },
  },
  'missing-source': {
    name: 'missing-source',
    describes: 'Source file absent. The fetch node fails, the digest node never runs.',
    groundTruth: {
      satisfied: 'no',
      mustSurfaceEvidenceKinds: ['node-status', 'absent'],
      mustFlagUnknownReasons: ['evidence-missing', 'not-inferred'],
    },
  },
  unobservable: {
    name: 'unobservable',
    describes:
      'Same successful execution as the happy path, but evaluated against an expectation '
      + 'about something sua cannot observe at all (whether the digest reached anyone). '
      + 'The detector must answer "undetermined" rather than inferring success from a '
      + 'clean run.',
    groundTruth: {
      satisfied: 'undetermined',
      mustSurfaceEvidenceKinds: ['node-result'],
      mustFlagUnknownReasons: ['not-observable-post-hoc', 'no-criteria', 'not-inferred'],
    },
  },
};

/**
 * The `unobservable` scenario overrides the agent's declared expectation.
 * Nothing about the execution changes — only what we are asking of it.
 */
const UNOBSERVABLE_EXPECTATION: OutcomeExpectation = {
  expected: 'The morning digest reached the team and someone acted on a headline in it.',
  assumptions: ['Someone is subscribed to the digest.'],
  evidence: [
    { kind: 'nodeResult', nodeId: 'summarise', label: 'The digest text that would have been sent' },
    { kind: 'runStatus' },
  ],
  unobservable: [
    'whether the digest was delivered to any recipient',
    'whether a recipient read it',
    'whether anyone acted on a headline',
  ],
  // Deliberately no `success:` — nothing here is machine-checkable, and
  // pretending otherwise is exactly the failure mode we are guarding against.
};

export function loadDigestAgent(): Agent {
  return parseAgent(readFileSync(AGENT_YAML, 'utf8'));
}

export type Judge = Parameters<typeof detectOutcome>[0]['judge'];

export interface MultiScenarioResult {
  scenario: ScenarioName;
  spec: ScenarioSpec;
  /** One record per judge label, all from the SAME execution. */
  records: Record<string, OutcomeRecord>;
  runStatus: string;
}

export interface ScenarioResult {
  scenario: ScenarioName;
  spec: ScenarioSpec;
  record: OutcomeRecord;
  runStatus: string;
}

/**
 * Execute one scenario for real, then detect its outcome once per supplied
 * judge.
 *
 * Detection is a pure function of (agent, run, nodeExecutions), so comparing
 * judges does NOT require re-running the agent. Re-executing per judge would
 * triple the number of real process spawns for no additional signal, and this
 * suite already oversubscribes CI enough to destabilise unrelated tests that
 * bind ports (see vitest.config.ts).
 */
export async function runScenarioMulti(
  scenario: ScenarioName,
  judges: Record<string, Judge>,
): Promise<MultiScenarioResult> {
  const dir = mkdtempSync(join(tmpdir(), `sua-outcome-${scenario}-`));
  try {
    // Every scenario gets its own hermetic working directory, so the run
    // never depends on process.cwd() and never touches the repo.
    const dataPath = 'headlines.json';
    if (scenario === 'happy' || scenario === 'unobservable') {
      writeFileSync(join(dir, dataPath), readFileSync(HEADLINES_JSON, 'utf8'));
    } else if (scenario === 'empty-source') {
      writeFileSync(join(dir, dataPath), JSON.stringify({ headlines: [] }, null, 2));
    }
    // 'missing-source' deliberately writes nothing.

    const base = loadDigestAgent();
    const agent: Agent = {
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === 'fetch'
          ? { ...n, workingDirectory: dir, toolInputs: { ...(n.toolInputs ?? {}), path: dataPath } }
          : n,
      ),
    };

    const runStore = new RunStore(join(dir, 'runs.db'));
    try {
      // ONE real execution…
      const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, { runStore });
      const nodeExecutions = runStore.listNodeExecutions(run.id);

      // …re-detected per judge.
      const records: Record<string, OutcomeRecord> = {};
      for (const [label, judge] of Object.entries(judges)) {
        records[label] = await detectOutcome({
          agent,
          run,
          nodeExecutions,
          ...(scenario === 'unobservable' && { expectation: UNOBSERVABLE_EXPECTATION }),
          ...(judge && { judge }),
        });
      }
      return { scenario, spec: SCENARIOS[scenario], records, runStatus: run.status };
    } finally {
      runStore.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Single-judge convenience wrapper. */
export async function runScenario(
  scenario: ScenarioName,
  options: { judge?: Judge } = {},
): Promise<ScenarioResult> {
  const multi = await runScenarioMulti(scenario, { default: options.judge });
  return {
    scenario: multi.scenario,
    spec: multi.spec,
    record: multi.records.default,
    runStatus: multi.runStatus,
  };
}

/** Run the full 12-run plan in order, detecting once per judge. */
export async function runAllScenariosMulti(
  judges: Record<string, Judge>,
): Promise<MultiScenarioResult[]> {
  const results: MultiScenarioResult[] = [];
  for (const name of SCENARIO_PLAN) {
    results.push(await runScenarioMulti(name, judges));
  }
  return results;
}

/** Run the full 12-run plan in order. */
export async function runAllScenarios(
  options: { judge?: Judge } = {},
): Promise<ScenarioResult[]> {
  const multi = await runAllScenariosMulti({ default: options.judge });
  return multi.map((m) => ({
    scenario: m.scenario,
    spec: m.spec,
    record: m.records.default,
    runStatus: m.runStatus,
  }));
}

/** Project a multi-judge result set down to one judge's `ScenarioResult[]`. */
export function forJudge(results: MultiScenarioResult[], label: string): ScenarioResult[] {
  return results.map((m) => ({
    scenario: m.scenario,
    spec: m.spec,
    record: m.records[label],
    runStatus: m.runStatus,
  }));
}
