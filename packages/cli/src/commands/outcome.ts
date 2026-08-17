/**
 * `sua outcome` — inspect the evidence-backed outcome records produced by
 * OutcomeDetection.
 *
 * Deliberately CLI-only in v0.1. Outcome records need to be read and
 * argued with before they earn a dashboard surface, and `agent_memory`
 * is the cautionary tale: it has been written and never read since it
 * shipped, because no read surface was ever built.
 */

import { Command } from 'commander';
import { OutcomeStore, type OutcomeRecord, type OutcomeVerdict } from '@some-useful-agents/core';
import { loadConfig, getDbPath } from '../config.js';
import * as ui from '../ui.js';

export const outcomeCommand = new Command('outcome')
  .description('Inspect outcome records — what resulted from a run, and the evidence for it');

function openStore(): OutcomeStore {
  return new OutcomeStore(getDbPath(loadConfig()));
}

const VERDICT_LABEL: Record<OutcomeVerdict, string> = {
  yes: 'achieved',
  partial: 'partially achieved',
  no: 'not achieved',
  undetermined: 'undetermined',
};

function colorVerdict(v: OutcomeVerdict): string {
  const label = VERDICT_LABEL[v];
  if (v === 'yes') return `\x1b[32m${label}\x1b[0m`;
  // `undetermined` is amber, not red: not knowing is a legitimate answer,
  // distinct from knowing the outcome was missed.
  if (v === 'undetermined') return `\x1b[33m${label}\x1b[0m`;
  return `\x1b[31m${label}\x1b[0m`;
}

outcomeCommand
  .command('list')
  .description('List recent outcome records, newest first')
  .option('-a, --agent <id>', 'Only records for this agent')
  .option('-u, --unsatisfied', 'Only records where the outcome was not fully achieved')
  .option('-n, --limit <n>', 'Maximum records to show', '20')
  .action((options: { agent?: string; unsatisfied?: boolean; limit: string }) => {
    const store = openStore();
    try {
      const rows = store.list({
        agentId: options.agent,
        unsatisfiedOnly: options.unsatisfied,
        limit: Number.parseInt(options.limit, 10) || 20,
      });
      if (rows.length === 0) {
        ui.info('No outcome records yet.');
        ui.info('Add an `outcome:` block to an agent, then run it. See docs/outcome-detection.md.');
        return;
      }
      ui.section(`Outcome records (${rows.length})`);
      for (const r of rows) {
        console.log(
          `  ${ui.id(r.runId.slice(0, 8))}  ${ui.agent(r.agentId.padEnd(22))}`
          + `  ${colorVerdict(r.satisfied).padEnd(28)}`
          + `  ${ui.dim(`${r.basis}/${r.confidence}`)}`
          + `  ${ui.dim(`${r.evidenceCount} evidence, ${r.unknownCount} unknown`)}`,
        );
      }
      console.log();
      ui.info(`Inspect one with ${ui.cmd(`sua outcome show ${rows[0].runId.slice(0, 8)}`)}`);
    } finally {
      store.close();
    }
  });

outcomeCommand
  .command('show')
  .description('Show one outcome record in full')
  .argument('<runId>', 'Run ID (full or unique prefix)')
  .option('--json', 'Emit the raw record as JSON')
  .action((runId: string, options: { json?: boolean }) => {
    const store = openStore();
    try {
      // Accept a prefix — run ids are UUIDs and nobody types those.
      const exact = store.get(runId);
      const row = exact ?? store.list({ limit: 500 }).find((r) => r.runId.startsWith(runId));
      if (!row) {
        ui.fail(`No outcome record for run "${runId}".`);
        process.exit(1);
      }
      if (options.json) {
        console.log(JSON.stringify(row.record, null, 2));
        return;
      }
      printRecord(row.record);
    } finally {
      store.close();
    }
  });

/**
 * Render a record with its four information tiers kept visually
 * separate — declared, observed, inferred, evaluated. Reading which is
 * which is the whole point; collapsing them into one prose summary would
 * throw away the property the record exists to preserve.
 */
function printRecord(rec: OutcomeRecord): void {
  ui.section(`Outcome — ${rec.agentId} v${rec.agentVersion}`);
  ui.kv('Run', rec.runId);
  ui.kv('Detected', rec.detectedAt);
  ui.kv('Run status', rec.execution.runStatus);
  ui.kv('Outcome', colorVerdict(rec.evaluation.satisfied));
  ui.kv('Basis', `${rec.evaluation.basis} (confidence: ${rec.evaluation.confidence})`);

  console.log(`\n  ${ui.dim('DECLARED — known before the run')}`);
  console.log(`  Expected: ${rec.intent.expected ?? ui.dim('(nothing declared)')}`);
  for (const a of rec.intent.assumptions) console.log(`  ${ui.dim('assumes:')} ${a}`);
  for (const u of rec.intent.unobservable) console.log(`  ${ui.dim('cannot observe:')} ${u}`);

  console.log(`\n  ${ui.dim('OBSERVED — captured during the run')}`);
  if (rec.observation.evidence.length === 0) console.log(`  ${ui.dim('(no evidence collected)')}`);
  for (const ev of rec.observation.evidence) {
    const where = ev.source.nodeId
      ? `node ${ev.source.nodeId}${ev.source.field ? `.${ev.source.field}` : ''}`
      : ev.source.path ?? 'run';
    const head = `  [${ev.id}] ${ev.kind} ${ui.dim(`← ${where}`)}${ev.label ? ` — ${ev.label}` : ''}`;
    console.log(head);
    const preview = ev.value.split('\n').slice(0, 4).join('\n        ');
    console.log(`        ${preview}${ev.truncated ? ui.dim(' …truncated') : ''}`);
  }

  if (rec.evaluation.criteriaResults?.length) {
    console.log(`\n  ${ui.dim('EVALUATED — deterministic criteria')}`);
    for (const c of rec.evaluation.criteriaResults) {
      const mark = c.passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      console.log(`  ${mark} ${c.description}${c.passed ? '' : ` — ${c.reason ?? 'failed'}`}`);
    }
  }

  if (rec.observation.observedOutcome || rec.evaluation.expectedVsObserved) {
    console.log(`\n  ${ui.dim('INFERRED — an LLM read the evidence above and nothing else')}`);
    if (rec.observation.observedOutcome) {
      console.log(`  What happened: ${rec.observation.observedOutcome.text}`);
      console.log(`  ${ui.dim(`cites ${rec.observation.observedOutcome.citedEvidenceIds.join(', ')}`)}`);
    }
    if (rec.evaluation.expectedVsObserved) {
      console.log(`  vs expected:   ${rec.evaluation.expectedVsObserved.text}`);
      console.log(`  ${ui.dim(`cites ${rec.evaluation.expectedVsObserved.citedEvidenceIds.join(', ')}`)}`);
    }
    if (rec.evaluation.judgeDisagreedWithCriteria) {
      ui.warn('The LLM disagreed with the deterministic criteria. The criteria won.');
    }
  }

  if (rec.unknowns.length > 0) {
    console.log(`\n  ${ui.dim('UNKNOWN — what could not be determined')}`);
    for (const u of rec.unknowns) {
      console.log(`  ${ui.dim(`[${u.reason}]`)} ${u.field}${u.detail ? `\n        ${u.detail}` : ''}`);
    }
  }

  if (rec.followUp?.length) {
    console.log(`\n  ${ui.dim('SUGGESTED FOLLOW-UP — advisory only, nothing acts on this')}`);
    for (const f of rec.followUp) console.log(`  - ${f}`);
  }
  console.log();
}
