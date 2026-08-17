/**
 * The declarative wiring: turn OutcomeDetection into a one-line dep on
 * any existing `executeAgentDag` / `executeAgentWithRetry` call.
 *
 *   await executeAgentDag(agent, opts, {
 *     runStore,
 *     onRunComplete: outcomeDetectionHook({ outcomeStore }),
 *   });
 *
 * Detection is opt-in per agent: an agent with no `outcome:` block is
 * skipped entirely, so registering the hook globally costs nothing for
 * the agents that haven't declared an expectation.
 *
 * Errors are swallowed. Detection is an observer — the run's result is
 * already committed by the time this fires, and a broken detector must
 * never be able to change what a run reports.
 */

import type { OnRunCompleteInfo } from '../dag-executor.js';
import { detectOutcome } from './detect.js';
import type { OutcomeStore } from './outcome-store.js';
import type { JudgeFn, OutcomeRecord } from './types.js';

export interface OutcomeDetectionHookOptions {
  /** Where records land. Omit to run detection for its side-effect-free `onRecord` only. */
  outcomeStore?: OutcomeStore;
  /**
   * Optional inference step. Omit for fully deterministic records — the
   * default, because a judge costs tokens and adds latency to whatever is
   * awaiting the run.
   */
  judge?: JudgeFn;
  /** Fires with each record after it is stored. For tests and custom sinks. */
  onRecord?: (record: OutcomeRecord) => void;
  logger?: { warn: (msg: string) => void };
}

export function outcomeDetectionHook(
  options: OutcomeDetectionHookOptions,
): (info: OnRunCompleteInfo) => Promise<void> {
  return async (info: OnRunCompleteInfo): Promise<void> => {
    if (!info.agent.outcome) return;
    try {
      const record = await detectOutcome({
        agent: info.agent,
        run: info.run,
        nodeExecutions: info.nodeExecutions,
        inputs: info.inputs,
        stateDir: info.stateDir,
        judge: options.judge,
      });
      options.outcomeStore?.record(record);
      options.onRecord?.(record);
    } catch (err) {
      const logger = options.logger ?? { warn: (m: string) => console.warn(`[outcome] ${m}`) };
      logger.warn(`detection failed for run ${info.run.id}: ${(err as Error).message}`);
    }
  };
}
