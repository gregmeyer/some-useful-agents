/**
 * End-to-end proof: really execute the shipped `two-step-digest` example
 * agent 12 times across four scenarios and check that the outcome records
 * answer the questions the capability exists to answer.
 *
 * Unlike every other dag-executor test in the repo, this one does NOT
 * inject a canned spawner. `two-step-digest` is pure builtin-tool + shell,
 * so it genuinely runs — which is the point. A proof against a fake
 * executor would prove nothing about evidence.
 *
 * Regenerate the committed artifact with:
 *   npm run outcome:fixture
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runAllScenarios,
  SCENARIO_PLAN,
  SCENARIOS,
  type ScenarioName,
  type ScenarioResult,
} from './fixtures/scenarios.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORDS_PATH = join(HERE, 'fixtures', 'records.jsonl');

// Real process spawns; 12 of them.
const TIMEOUT = 120_000;

// One execution pass for the whole file. The focused describes below pick
// from it rather than re-running the agent — 12 real spawns, not 15.
let results: ScenarioResult[];
const first = (scenario: ScenarioName): ScenarioResult =>
  results.find((r) => r.scenario === scenario)!;

beforeAll(async () => {
  results = await runAllScenarios();
  if (process.env.SUA_WRITE_OUTCOME_FIXTURE === '1') {
    mkdirSync(dirname(RECORDS_PATH), { recursive: true });
    const lines = results.map((r) => JSON.stringify({
      scenario: r.scenario,
      describes: r.spec.describes,
      runStatus: r.runStatus,
      record: r.record,
    }));
    writeFileSync(RECORDS_PATH, `${lines.join('\n')}\n`);
  }
}, TIMEOUT);

describe('OutcomeDetection end-to-end over two-step-digest', () => {
  it('runs the full 12-run plan', () => {
    expect(results).toHaveLength(12);
  });

  it('does not report success on everything', () => {
    const verdicts = results.map((r) => r.record.evaluation.satisfied);
    expect(verdicts.filter((v) => v === 'yes')).toHaveLength(6);
    expect(verdicts.filter((v) => v !== 'yes')).toHaveLength(6);
    expect(new Set(verdicts)).toEqual(new Set(['yes', 'partial', 'no', 'undetermined']));
  });

  it('matches ground truth on every run', () => {
    for (const r of results) {
      expect(r.record.evaluation.satisfied, `${r.scenario} verdict`).toBe(r.spec.groundTruth.satisfied);
    }
  });

  // Every record must answer the seven questions the capability exists for.
  it('answers all seven questions for every record', () => {
    for (const r of results) {
      const rec = r.record;
      expect(rec.intent.expected, 'what did the system expect?').toBeTruthy();
      expect(rec.execution.nodes.length, 'what actually happened?').toBeGreaterThan(0);
      expect(rec.observation.evidence.length, 'what evidence supports that?').toBeGreaterThan(0);
      // What was inferred rather than observed: separable by construction.
      expect(rec.observation).toHaveProperty('evidence');
      expect(rec.evaluation.satisfied, 'did it satisfy the expectation?').toBeTruthy();
      expect(rec.evaluation.confidence, 'how confident?').toBeTruthy();
      expect(Array.isArray(rec.unknowns), 'what was missing?').toBe(true);
      expect(rec.unknowns.length, 'every record admits at least one gap').toBeGreaterThan(0);
    }
  });

  it('grounds every evidence item in a resolvable provenance pointer', () => {
    for (const r of results) {
      for (const ev of r.record.observation.evidence) {
        expect(ev.source.runId).toBe(r.record.runId);
        const hasPointer = Boolean(ev.source.nodeId || ev.source.path || ev.kind === 'run-status');
        expect(hasPointer, `${ev.id} in ${r.scenario} has no pointer`).toBe(true);
      }
    }
  });

  it('surfaces the evidence kinds each scenario materially depends on', () => {
    for (const r of results) {
      const kinds = new Set(r.record.observation.evidence.map((e) => e.kind));
      for (const required of r.spec.groundTruth.mustSurfaceEvidenceKinds) {
        expect(kinds.has(required as never), `${r.scenario} missing evidence kind ${required}`).toBe(true);
      }
    }
  });

  it('flags the unknowns each scenario should not be able to resolve', () => {
    for (const r of results) {
      const reasons = new Set(r.record.unknowns.map((u) => u.reason));
      for (const required of r.spec.groundTruth.mustFlagUnknownReasons) {
        expect(reasons.has(required as never), `${r.scenario} missing unknown reason ${required}`).toBe(true);
      }
    }
  });

  // With no judge configured, NOTHING in the record may be inferred prose.
  it('produces zero inferred claims when no judge is supplied', () => {
    for (const r of results) {
      expect(r.record.observation.observedOutcome).toBeUndefined();
      expect(r.record.evaluation.expectedVsObserved).toBeUndefined();
      expect(r.record.unknowns.some((u) => u.reason === 'not-inferred')).toBe(true);
    }
  });
});

describe('the scenario that matters most: clean run, unmet outcome', () => {
  it('separates run success from outcome success', () => {
    const r = first('empty-source');

    // sua's own execution machinery is perfectly happy.
    expect(r.runStatus).toBe('completed');
    expect(r.record.execution.nodes.every((n) => n.status === 'completed')).toBe(true);

    // The outcome was not reached, and the record says exactly why.
    expect(r.record.evaluation.satisfied).toBe('partial');
    const failed = r.record.evaluation.criteriaResults!.filter((c) => !c.passed);
    expect(failed).toHaveLength(1);
    expect(failed[0].description).toContain('regexMatch');

    // …and the evidence behind that judgement is inspectable.
    const digest = r.record.observation.evidence.find((e) => e.source.nodeId === 'summarise');
    expect(digest?.value).toContain('0 headlines loaded');
  });
});

describe('the scenario where detection must refuse to answer', () => {
  it('returns undetermined instead of inferring success from a clean run', () => {
    const r = first('unobservable');

    expect(r.runStatus).toBe('completed');
    expect(r.record.evaluation.satisfied).toBe('undetermined');
    expect(r.record.evaluation.basis).toBe('undetermined');
    expect(r.record.evaluation.confidence).toBe('low');

    const blind = r.record.unknowns.filter((u) => u.reason === 'not-observable-post-hoc');
    expect(blind).toHaveLength(3);
    expect(blind.map((b) => b.detail).join(' ')).toContain('delivered');

    // Evidence was still collected — the run genuinely produced a digest.
    // We just can't say whether the *outcome* happened.
    expect(r.record.observation.evidence.some((e) => e.kind === 'node-result')).toBe(true);
  });
});

describe('the failure scenario', () => {
  it('records what broke and marks the missing downstream output absent', () => {
    const r = first('missing-source');

    expect(r.runStatus).toBe('failed');
    expect(r.record.evaluation.satisfied).toBe('no');

    const fetchNode = r.record.execution.nodes.find((n) => n.nodeId === 'fetch');
    expect(fetchNode?.status).toBe('failed');

    // The digest node never produced anything — recorded as absent, not omitted.
    const absent = r.record.observation.evidence.filter((e) => e.kind === 'absent');
    expect(absent.length).toBeGreaterThan(0);
    expect(r.record.unknowns.some((u) => u.reason === 'evidence-missing')).toBe(true);
  });
});

describe('scenario plan', () => {
  it('covers success, partial, hard failure, and undetermined', () => {
    const covered = new Set(SCENARIO_PLAN.map((s) => SCENARIOS[s].groundTruth.satisfied));
    expect(covered).toEqual(new Set(['yes', 'partial', 'no', 'undetermined']));
  });
});
