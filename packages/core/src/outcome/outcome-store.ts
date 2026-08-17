/**
 * Persistence for outcome records plus immutable history.
 *
 * `outcome_records` stays the latest-state materialization for existing
 * readers. v0.2 adds append-only evidence + evaluation tables so later
 * verification does not overwrite what the system previously believed.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Agent, NodeExecutionRecord } from '../agent-v2-types.js';
import type { Run } from '../types.js';
import { openStoreDb } from '../sqlite-open.js';
import { evaluateOutcome } from './detect.js';
import type {
  EvidenceItem,
  JudgeFn,
  OutcomeConfidence,
  OutcomeEvaluationRecord,
  OutcomeHistory,
  OutcomeHistoryChangeReason,
  OutcomeHistoryEvaluation,
  OutcomeHistoryEvidence,
  OutcomeExpectation,
  OutcomeRecord,
  OutcomeVerdict,
  UnknownItem,
} from './types.js';

export interface OutcomeRow {
  runId: string;
  agentId: string;
  agentVersion: number;
  satisfied: OutcomeVerdict;
  basis: OutcomeRecord['evaluation']['basis'];
  confidence: OutcomeRecord['evaluation']['confidence'];
  evidenceCount: number;
  unknownCount: number;
  detectedAt: string;
  record: OutcomeRecord;
}

export interface PersistedOutcomeEvidence {
  runId: string;
  evidence: EvidenceItem;
}

export interface RecordOutcomeOptions {
  contractSnapshot?: OutcomeExpectation;
  evaluator?: OutcomeEvaluationRecord['evaluator'];
  criteriaEngineVersion?: string;
}

export interface AttachOutcomeEvidenceInput {
  agent: Agent;
  run: Run;
  nodeExecutions: NodeExecutionRecord[];
  expectation: OutcomeExpectation;
  evidence: Array<Omit<EvidenceItem, 'id'> & { id?: string }>;
  judge?: JudgeFn;
  now?: () => Date;
  evaluator?: OutcomeEvaluationRecord['evaluator'];
  criteriaEngineVersion?: string;
}

export interface ListOutcomesQuery {
  agentId?: string;
  /** Only rows whose verdict is not `yes`. The interesting ones. */
  unsatisfiedOnly?: boolean;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const OUTCOME_EVALUATOR_VERSION = 'outcome-store/v0.2';
const OUTCOME_CRITERIA_ENGINE_VERSION = 'evaluateCriteria/v1';

export class OutcomeStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;

  constructor(dbPath: string) {
    this.db = openStoreDb(dbPath);
    this.ownsConnection = true;
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): OutcomeStore {
    const store = Object.create(OutcomeStore.prototype) as OutcomeStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outcome_records (
        run_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_version INTEGER NOT NULL,
        satisfied TEXT NOT NULL,
        basis TEXT NOT NULL,
        confidence TEXT NOT NULL,
        evidence_count INTEGER NOT NULL,
        unknown_count INTEGER NOT NULL,
        detected_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      )
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_outcome_agent_time ON outcome_records(agent_id, detected_at DESC)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_outcome_satisfied ON outcome_records(satisfied, detected_at DESC)`,
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outcome_evidence (
        evidence_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        observing_run_id TEXT,
        provenance_source TEXT NOT NULL,
        observation_mode TEXT NOT NULL,
        subject_type TEXT,
        subject_id TEXT,
        captured_at TEXT NOT NULL,
        evidence_json TEXT NOT NULL
      )
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_outcome_evidence_run_time ON outcome_evidence(run_id, captured_at ASC, evidence_id ASC)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_outcome_evidence_observing_run ON outcome_evidence(observing_run_id, captured_at ASC)`,
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outcome_evaluations (
        evaluation_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        input_fingerprint TEXT NOT NULL,
        contract_hash TEXT NOT NULL,
        evaluated_at TEXT NOT NULL,
        verdict TEXT NOT NULL,
        basis TEXT NOT NULL,
        confidence TEXT NOT NULL,
        criteria_engine_version TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL,
        evaluator_json TEXT NOT NULL,
        unknowns_json TEXT NOT NULL,
        criteria_results_json TEXT,
        contract_json TEXT NOT NULL,
        record_json TEXT NOT NULL
      )
    `);
    const evaluationColumns = tableColumns(this.db, 'outcome_evaluations');
    if (!evaluationColumns.has('input_fingerprint')) {
      this.db.exec(`ALTER TABLE outcome_evaluations ADD COLUMN input_fingerprint TEXT NOT NULL DEFAULT ''`);
      this.db.exec(`
        UPDATE outcome_evaluations
        SET input_fingerprint = COALESCE(input_fingerprint, '')
        WHERE input_fingerprint = ''
      `);
    }
    if (!evaluationColumns.has('criteria_engine_version')) {
      this.db.exec(`ALTER TABLE outcome_evaluations ADD COLUMN criteria_engine_version TEXT NOT NULL DEFAULT '${OUTCOME_CRITERIA_ENGINE_VERSION}'`);
    }
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_outcome_evaluations_run_time ON outcome_evaluations(run_id, evaluated_at DESC, evaluation_id DESC)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_outcome_evaluations_input_fingerprint ON outcome_evaluations(run_id, input_fingerprint, evaluated_at ASC)`,
    );
  }

  /** Latest-state compatibility API. Also records immutable evidence/evaluation history. */
  record(rec: OutcomeRecord, options: RecordOutcomeOptions = {}): OutcomeEvaluationRecord {
    const contractSnapshot = options.contractSnapshot ?? contractSnapshotFromRecord(rec);
    this.appendEvidenceRows(
      rec.runId,
      rec.observation.evidence.map((evidence) => ({ runId: rec.runId, evidence })),
    );

    const evaluation = this.buildEvaluationRecord({
      record: rec,
      contractSnapshot,
      evaluator: options.evaluator,
      criteriaEngineVersion: options.criteriaEngineVersion,
    });
    this.appendEvaluationRow(evaluation);
    this.materializeLatest(rec);
    return evaluation;
  }

  async attachEvidenceAndReevaluate(input: AttachOutcomeEvidenceInput): Promise<OutcomeEvaluationRecord> {
    const attached = input.evidence.map((evidence, index) => ({
      runId: input.run.id,
      evidence: normalizeAttachedEvidence({
        runId: input.run.id,
        evidence,
        fallbackIndex: index,
        now: input.now ?? (() => new Date()),
      }),
    }));
    this.appendEvidenceRows(input.run.id, attached);

    const allEvidence = this.listEvidence(input.run.id).map((row) => row.evidence);
    const record = await evaluateOutcome({
      agent: input.agent,
      run: input.run,
      nodeExecutions: input.nodeExecutions,
      expectation: input.expectation,
      evidence: allEvidence,
      judge: input.judge,
      now: input.now,
    });

    const evaluation = this.buildEvaluationRecord({
      record,
      contractSnapshot: input.expectation,
      evaluator: input.evaluator,
      criteriaEngineVersion: input.criteriaEngineVersion,
    });
    this.appendEvaluationRow(evaluation);
    this.materializeLatest(record);
    return evaluation;
  }

  get(runId: string): OutcomeRow | null {
    const row = this.db.prepare(
      `SELECT * FROM outcome_records WHERE run_id = ?`,
    ).get(runId) as Record<string, unknown> | undefined;
    return row ? this.rowToOutcome(row) : null;
  }

  list(query: ListOutcomesQuery = {}): OutcomeRow[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.agentId) {
      where.push('agent_id = ?');
      params.push(query.agentId);
    }
    if (query.unsatisfiedOnly) {
      where.push(`satisfied != 'yes'`);
    }
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const sql = `
      SELECT * FROM outcome_records
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY detected_at DESC
      LIMIT ${limit}
    `;
    const rows = this.db.prepare(sql).all(...(params as never[])) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToOutcome(r));
  }

  listEvidence(runId: string): PersistedOutcomeEvidence[] {
    const rows = this.db.prepare(`
      SELECT run_id, evidence_json
      FROM outcome_evidence
      WHERE run_id = ?
      ORDER BY captured_at ASC, evidence_id ASC
    `).all(runId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      runId: row.run_id as string,
      evidence: JSON.parse(row.evidence_json as string) as EvidenceItem,
    }));
  }

  listEvaluations(runId: string): OutcomeEvaluationRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM outcome_evaluations
      WHERE run_id = ?
      ORDER BY evaluated_at ASC, evaluation_id ASC
    `).all(runId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToEvaluation(row));
  }

  getHistory(runId: string): OutcomeHistory | null {
    const evaluations = this.listEvaluations(runId);
    if (evaluations.length === 0) return null;
    const evidenceIndex = new Map(this.listEvidence(runId).map((row) => [row.evidence.id, row.evidence]));
    const items: OutcomeHistoryEvaluation[] = evaluations.map((evaluation, index) => {
      const previous = index > 0 ? evaluations[index - 1] : undefined;
      const evidence = evaluation.evidenceIds
        .map((id) => evidenceIndex.get(id))
        .filter((item): item is EvidenceItem => Boolean(item))
        .map(mapHistoryEvidence);
      const previousEvidenceIds = new Set(previous?.evidenceIds ?? []);
      const addedEvidence = evidence.filter((item) => !previousEvidenceIds.has(item.id));
      return {
        evaluationId: evaluation.evaluationId,
        inputFingerprint: evaluation.inputFingerprint,
        evaluatedAt: evaluation.evaluatedAt,
        verdict: evaluation.verdict,
        contractHash: evaluation.contractHash,
        contractSnapshot: evaluation.contractSnapshot,
        evaluator: evaluation.evaluator,
        criteriaEngineVersion: evaluation.criteriaEngineVersion,
        evidenceIds: evaluation.evidenceIds,
        changeReason: classifyHistoryChange(previous, evaluation),
        evidence,
        addedEvidence,
      };
    });

    const latest = items[items.length - 1];
    return {
      runId,
      latestVerdict: latest.verdict,
      latestEvaluatedAt: latest.evaluatedAt,
      evaluations: items,
    };
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }

  private appendEvidenceRows(runId: string, evidenceRows: PersistedOutcomeEvidence[]): void {
    if (evidenceRows.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO outcome_evidence (
        evidence_id, run_id, observing_run_id, provenance_source, observation_mode,
        subject_type, subject_id, captured_at, evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const { evidence } of evidenceRows) {
      const provenance = evidence.source.provenance ?? {
        source: evidence.source.selector ?? 'outcome-selector',
        observationMode: 'direct' as const,
      };
      stmt.run(
        evidence.id,
        runId,
        provenance.observingRunId ?? null,
        provenance.source,
        provenance.observationMode,
        evidence.subject?.type ?? null,
        evidence.subject?.id ?? null,
        evidence.capturedAt,
        JSON.stringify(evidence),
      );
    }
  }

  private appendEvaluationRow(evaluation: OutcomeEvaluationRecord): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO outcome_evaluations (
        evaluation_id, run_id, input_fingerprint, contract_hash, evaluated_at, verdict, basis, confidence,
        criteria_engine_version,
        evidence_ids_json, evaluator_json, unknowns_json, criteria_results_json,
        contract_json, record_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evaluation.evaluationId,
      evaluation.runId,
      evaluation.inputFingerprint,
      evaluation.contractHash,
      evaluation.evaluatedAt,
      evaluation.verdict,
      evaluation.basis,
      evaluation.confidence,
      evaluation.criteriaEngineVersion,
      JSON.stringify(evaluation.evidenceIds),
      JSON.stringify(evaluation.evaluator),
      JSON.stringify(evaluation.unknowns),
      evaluation.criteriaResults ? JSON.stringify(evaluation.criteriaResults) : null,
      JSON.stringify(evaluation.contractSnapshot),
      JSON.stringify(evaluation.record),
    );
  }

  private materializeLatest(rec: OutcomeRecord): void {
    this.db.prepare(`
      INSERT INTO outcome_records (
        run_id, agent_id, agent_version, satisfied, basis, confidence,
        evidence_count, unknown_count, detected_at, record_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        agent_version = excluded.agent_version,
        satisfied = excluded.satisfied,
        basis = excluded.basis,
        confidence = excluded.confidence,
        evidence_count = excluded.evidence_count,
        unknown_count = excluded.unknown_count,
        detected_at = excluded.detected_at,
        record_json = excluded.record_json
    `).run(
      rec.runId,
      rec.agentId,
      rec.agentVersion,
      rec.evaluation.satisfied,
      rec.evaluation.basis,
      rec.evaluation.confidence,
      rec.observation.evidence.length,
      rec.unknowns.length,
      rec.detectedAt,
      JSON.stringify(rec),
    );
  }

  private buildEvaluationRecord(input: {
    record: OutcomeRecord;
    contractSnapshot: OutcomeExpectation;
    evaluator?: OutcomeEvaluationRecord['evaluator'];
    criteriaEngineVersion?: string;
  }): OutcomeEvaluationRecord {
    const contractHash = hashJson(input.contractSnapshot);
    const evidenceIds = input.record.observation.evidence.map((e) => e.id);
    const evaluator = input.evaluator ?? {
      kind: input.record.evaluation.basis === 'judged' ? 'judge' : 'deterministic',
      version: OUTCOME_EVALUATOR_VERSION,
    };
    const criteriaEngineVersion = input.criteriaEngineVersion ?? OUTCOME_CRITERIA_ENGINE_VERSION;
    const inputFingerprint = hashEvaluationInputs({
      runId: input.record.runId,
      contractHash,
      evidenceIds,
      evaluator,
      criteriaEngineVersion,
    });
    return {
      evaluationId: buildEvaluationEventId(input.record.runId, input.record.detectedAt),
      runId: input.record.runId,
      evaluatedAt: input.record.detectedAt,
      inputFingerprint,
      contractHash,
      contractSnapshot: input.contractSnapshot,
      evidenceIds,
      evaluator,
      criteriaEngineVersion,
      verdict: input.record.evaluation.satisfied,
      basis: input.record.evaluation.basis,
      confidence: input.record.evaluation.confidence,
      unknowns: input.record.unknowns,
      ...(input.record.evaluation.criteriaResults && { criteriaResults: input.record.evaluation.criteriaResults }),
      record: input.record,
    };
  }

  private rowToOutcome = (r: Record<string, unknown>): OutcomeRow => ({
    runId: r.run_id as string,
    agentId: r.agent_id as string,
    agentVersion: r.agent_version as number,
    satisfied: r.satisfied as OutcomeVerdict,
    basis: r.basis as OutcomeRecord['evaluation']['basis'],
    confidence: r.confidence as OutcomeRecord['evaluation']['confidence'],
    evidenceCount: r.evidence_count as number,
    unknownCount: r.unknown_count as number,
    detectedAt: r.detected_at as string,
    record: JSON.parse(r.record_json as string) as OutcomeRecord,
  });

  private rowToEvaluation = (r: Record<string, unknown>): OutcomeEvaluationRecord => ({
    evaluationId: r.evaluation_id as string,
    runId: r.run_id as string,
    evaluatedAt: r.evaluated_at as string,
    inputFingerprint: r.input_fingerprint as string,
    contractHash: r.contract_hash as string,
    contractSnapshot: JSON.parse(r.contract_json as string) as OutcomeExpectation,
    evidenceIds: JSON.parse(r.evidence_ids_json as string) as string[],
    evaluator: JSON.parse(r.evaluator_json as string) as OutcomeEvaluationRecord['evaluator'],
    criteriaEngineVersion: r.criteria_engine_version as string,
    verdict: r.verdict as OutcomeVerdict,
    basis: r.basis as OutcomeRecord['evaluation']['basis'],
    confidence: r.confidence as OutcomeConfidence,
    unknowns: JSON.parse(r.unknowns_json as string) as UnknownItem[],
    ...(r.criteria_results_json
      ? { criteriaResults: JSON.parse(r.criteria_results_json as string) as NonNullable<OutcomeEvaluationRecord['criteriaResults']> }
      : {}),
    record: JSON.parse(r.record_json as string) as OutcomeRecord,
  });
}

function normalizeAttachedEvidence(input: {
  runId: string;
  evidence: Omit<EvidenceItem, 'id'> & { id?: string };
  fallbackIndex: number;
  now: () => Date;
}): EvidenceItem {
  const capturedAt = input.evidence.capturedAt ?? input.now().toISOString();
  const normalized: EvidenceItem = {
    ...input.evidence,
    id: input.evidence.id ?? hashEvidenceId(input.runId, { ...input.evidence, capturedAt }),
    capturedAt,
    source: {
      ...input.evidence.source,
      runId: input.runId,
      provenance: input.evidence.source.provenance ?? {
        source: input.evidence.source.selector ?? `attached-evidence-${input.fallbackIndex + 1}`,
        observationMode: 'direct',
      },
    },
  };
  return normalized;
}

function contractSnapshotFromRecord(record: OutcomeRecord): OutcomeExpectation {
  return {
    ...(record.intent.expected !== undefined && { expected: record.intent.expected }),
    assumptions: record.intent.assumptions,
    ...(record.intent.success ? { success: record.intent.success } : {}),
    unobservable: record.intent.unobservable,
  };
}

function hashEvidenceId(runId: string, evidence: Omit<EvidenceItem, 'id'>): string {
  return `ev_${hashJson({ runId, evidence }).slice(0, 12)}`;
}

function hashEvaluationInputs(input: {
  runId: string;
  contractHash: string;
  evidenceIds: string[];
  evaluator: OutcomeEvaluationRecord['evaluator'];
  criteriaEngineVersion: string;
}): string {
  return hashJson({
    runId: input.runId,
    contractHash: input.contractHash,
    evidenceIds: [...input.evidenceIds].sort(),
    evaluator: input.evaluator,
    criteriaEngineVersion: input.criteriaEngineVersion,
  });
}

function buildEvaluationEventId(runId: string, evaluatedAt: string): string {
  return `oeval_${hashJson({ runId, evaluatedAt, nonce: randomUUID() }).slice(0, 16)}`;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function mapHistoryEvidence(evidence: EvidenceItem): OutcomeHistoryEvidence {
  return {
    id: evidence.id,
    observedAt: evidence.capturedAt,
    source: evidence.source.provenance?.source ?? evidence.source.selector ?? 'unknown',
    ...(evidence.subject ? { subject: evidence.subject } : {}),
    originatingRunId: evidence.source.runId,
    ...(evidence.source.provenance?.observingRunId ? { observingRunId: evidence.source.provenance.observingRunId } : {}),
    observationMode: evidence.source.provenance?.observationMode ?? 'direct',
  };
}

function classifyHistoryChange(
  previous: OutcomeEvaluationRecord | undefined,
  current: OutcomeEvaluationRecord,
): OutcomeHistoryChangeReason[] {
  if (!previous) return ['initial evaluation'];
  const reasons: OutcomeHistoryChangeReason[] = [];
  if (previous.contractHash !== current.contractHash) reasons.push('contract changed');
  if (stableStringify(previous.evaluator) !== stableStringify(current.evaluator)) reasons.push('evaluator changed');
  if (previous.criteriaEngineVersion !== current.criteriaEngineVersion) reasons.push('criteria engine changed');
  if (stableStringify(previous.evidenceIds) !== stableStringify(current.evidenceIds)) reasons.push('new evidence');
  if (previous.inputFingerprint === current.inputFingerprint) reasons.push('identical-input rerun');
  return reasons.length > 0 ? reasons : ['identical-input rerun'];
}
