/**
 * Schema for the structured plan emitted by the build-planner agent.
 *
 * The build wizard sends a goal → planner returns a BuildPlan → wizard
 * renders survey + proposal + questions → user confirms → commit endpoint
 * walks the plan to create agents and the dashboard.
 *
 * Validation runs server-side after extracting the plan JSON from the
 * planner's `<plan>…</plan>` wrapper. Loose enough to absorb LLM noise
 * (optional fields default to []), strict enough to catch obvious
 * structural lies (intent='agent' with a non-null dashboard, etc.).
 */

import { z } from 'zod';

const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
const DASHBOARD_ID_RE = /^user:[a-z0-9][a-z0-9_-]*$/;

export const buildPlanSchema = z.object({
  intent: z.enum(['agent', 'dashboard-existing', 'dashboard-new', 'dashboard-mixed']),
  summary: z.string().min(1, 'summary is required'),

  survey: z.object({
    matchedAgents: z.array(z.object({
      id: z.string().regex(AGENT_ID_RE, 'matchedAgents.id must be lowercase_with_dashes'),
      matchedFor: z.string().min(1),
    })).default([]),
    missingFor: z.array(z.string().min(1)).default([]),
    // Planner sometimes emits `existingDashboards` as a bare string array
    // (just the dashboard ids) instead of objects with id/name/reason.
    // Coerce strings into the canonical object shape so the rest of the
    // plan still validates and the user sees a usable card. Surfaced by
    // the smoke runner — see /Users/grmeyer/.claude/plans/can-we-build-these-warm-finch.md.
    existingDashboards: z.array(
      z.union([
        z.string().min(1).transform((id) => ({ id, name: '', reason: '' })),
        z.object({
          id: z.string().min(1),
          name: z.string().optional().default(''),
          reason: z.string().optional().default(''),
        }),
      ]),
    ).default([]),
  }).default({ matchedAgents: [], missingFor: [], existingDashboards: [] }),

  newAgents: z.array(z.object({
    id: z.string().regex(AGENT_ID_RE, 'newAgents.id must be lowercase_with_dashes'),
    purpose: z.string().min(1),
    yaml: z.string().min(1, 'newAgents.yaml is required'),
  })).default([]),

  dashboard: z.union([
    z.null(),
    z.object({
      id: z.string().regex(DASHBOARD_ID_RE, 'dashboard.id must start with "user:"'),
      name: z.string().min(1),
      sections: z.array(z.object({
        title: z.string().min(1),
        agentIds: z.array(z.string().min(1)).min(1, 'each section needs at least one agent'),
      })).min(1, 'dashboard needs at least one section'),
    }),
  ]).default(null),

  questions: z.array(z.object({
    text: z.string().min(1),
    suggestedAnswer: z.string().optional(),
  })).default([]),
}).superRefine((plan, ctx) => {
  // intent='agent' must have exactly one new agent and no dashboard.
  if (plan.intent === 'agent') {
    if (plan.dashboard !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dashboard'],
        message: 'intent="agent" must have dashboard=null',
      });
    }
    if (plan.newAgents.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newAgents'],
        message: 'intent="agent" must have exactly one newAgents entry',
      });
    }
  }

  // dashboard-bearing intents must have a dashboard.
  if (plan.intent !== 'agent' && plan.dashboard === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dashboard'],
      message: `intent="${plan.intent}" requires a dashboard`,
    });
  }

  // intent='dashboard-existing' must not propose new agents.
  if (plan.intent === 'dashboard-existing' && plan.newAgents.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['newAgents'],
      message: 'intent="dashboard-existing" must not include new agents',
    });
  }

  // dashboard.sections.agentIds must reference EITHER a matched existing
  // agent OR a newAgents entry. Catches "I made up an id" hallucinations.
  if (plan.dashboard) {
    const knownIds = new Set<string>([
      ...plan.survey.matchedAgents.map((m) => m.id),
      ...plan.newAgents.map((a) => a.id),
    ]);
    plan.dashboard.sections.forEach((s, sIdx) => {
      s.agentIds.forEach((id, aIdx) => {
        if (!knownIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['dashboard', 'sections', sIdx, 'agentIds', aIdx],
            message: `agent id "${id}" is not in survey.matchedAgents or newAgents — planner hallucinated it`,
          });
        }
      });
    });
  }
});

export type BuildPlanInput = z.input<typeof buildPlanSchema>;
export type BuildPlan = z.output<typeof buildPlanSchema>;

/**
 * Extract a plan JSON string from a raw LLM response. Strips common
 * wrappers: `<plan>…</plan>`, ```json fences, ``` fences. Returns the
 * trimmed JSON text ready for `JSON.parse`. Returns null when no plan
 * block can be located.
 */
export function extractPlanJson(raw: string): string | null {
  const planTag = /<plan>([\s\S]*?)<\/plan>/i.exec(raw);
  if (planTag) return planTag[1].trim();

  // Code fence with json hint.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenced) return fenced[1].trim();

  // Bare JSON-looking blob.
  const bare = raw.trim();
  if (bare.startsWith('{') && bare.endsWith('}')) return bare;

  return null;
}
