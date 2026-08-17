/**
 * Zod schema for the `outcome:` block on a v2 agent.
 *
 * Kept in the outcome module rather than inlined into agent-v2-schema.ts
 * so the whole capability reads as one unit, but imported and spliced
 * into `agentV2Schema` there like any other field.
 */

import { z } from 'zod';

/**
 * Success criteria reuse the existing `successCriteria` union verbatim.
 * Defined here (rather than imported from agent-v2-schema.ts) to avoid a
 * circular import — agent-v2-schema.ts imports THIS file. The shape is
 * asserted equal to `agentV2Schema.successCriteria` by a test.
 */
export const outcomeSuccessCriterionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shellExitZero'), nodeId: z.string().min(1) }),
  z.object({ kind: z.literal('fileExists'), pathTemplate: z.string().min(1) }),
  z.object({ kind: z.literal('jsonPathEquals'), nodeId: z.string().min(1), path: z.string().min(1), equals: z.unknown() }),
  z.object({ kind: z.literal('regexMatch'), nodeId: z.string().min(1), pattern: z.string().min(1) }),
]);

export const evidenceSelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('nodeResult'), nodeId: z.string().min(1), label: z.string().optional() }),
  z.object({ kind: z.literal('nodeOutputField'), nodeId: z.string().min(1), field: z.string().min(1), label: z.string().optional() }),
  z.object({ kind: z.literal('nodeStatus'), nodeId: z.string().min(1), label: z.string().optional() }),
  z.object({ kind: z.literal('runStatus'), label: z.string().optional() }),
  z.object({ kind: z.literal('file'), pathTemplate: z.string().min(1), label: z.string().optional() }),
]);

export const outcomeExpectationSchema = z.object({
  /** Prose statement of what this agent is supposed to result in. */
  expected: z.string().min(1).optional(),
  /** Taken for granted, recorded, never verified. */
  assumptions: z.array(z.string()).optional(),
  /** What to collect as evidence. Without this, records carry no observations. */
  evidence: z.array(evidenceSelectorSchema).optional(),
  /** Machine-checkable definition of done. Same grammar as `successCriteria`. */
  success: z.array(outcomeSuccessCriterionSchema).optional(),
  /**
   * Parts of the expected outcome sua provably cannot observe. Declaring
   * one forces the verdict away from `yes` and adds a typed unknown —
   * the honest alternative to a detector quietly claiming full success.
   */
  unobservable: z.array(z.string()).optional(),
}).strict();

export type OutcomeExpectationParsed = z.infer<typeof outcomeExpectationSchema>;
