/**
 * Schema for the structured output of the goal-surveyor agent (stage 1
 * of the build orchestrator).
 *
 * The build orchestrator reads a free-form goal → kicks off the surveyor
 * → parses the survey → fans out one agent-drafter per fragment in
 * parallel → optionally kicks off the dashboard-designer → assembles
 * everything into a BuildPlan (see `build-plan-schema.ts`).
 *
 * The survey itself is intermediate state; the user-facing artifact
 * remains the BuildPlan. We validate this loosely (optional fields
 * default to []) but strictly enough to catch obvious LLM noise.
 */

import { z } from 'zod';

const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

export const surveySchema = z.object({
  intent: z.enum(['agent', 'dashboard-existing', 'dashboard-new', 'dashboard-mixed']),
  summary: z.string().min(1, 'summary is required'),

  /**
   * Agents the surveyor matched against the goal. Existing agents the
   * orchestrator will reuse — no drafting needed.
   */
  matchedAgents: z.array(z.object({
    id: z.string().regex(AGENT_ID_RE, 'matchedAgents.id must be lowercase_with_dashes_or_underscores'),
    matchedFor: z.string().min(1),
  })).default([]),

  /**
   * Goal fragments that have no installed match — these become
   * agent-drafter invocations. Each is one purpose, optionally with a
   * suggested id (the drafter may rename to avoid collisions).
   */
  fragments: z.array(z.object({
    purpose: z.string().min(1, 'fragments.purpose is required'),
    suggestedName: z.string().regex(AGENT_ID_RE, 'fragments.suggestedName must be lowercase_with_dashes_or_underscores').optional(),
  })).default([]),

  /**
   * Installed dashboards that overlap with the goal theme. Surfaced to
   * the user as "looks like you have one of these already" — no
   * automatic merge.
   */
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

  /**
   * Available packs the surveyor thinks could cover one or more
   * fragments. Orchestrator surfaces these as suggestions, not
   * auto-installs.
   */
  packSuggestions: z.array(z.object({
    packId: z.string().min(1),
    coversFragment: z.string().min(1),
  })).default([]),

  /**
   * Clarifying questions, same shape as build-planner's questions[].
   * The orchestrator passes these through to the BuildPlan unchanged
   * so the wizard can render the existing questions UI.
   */
  questions: z.array(z.object({
    text: z.string().min(1),
    suggestedAnswer: z.string().optional(),
    options: z.array(z.string().min(1)).optional(),
  })).default([]),
}).superRefine((survey, ctx) => {
  // Intent vs. content consistency. These mirror the validator rules
  // in build-plan-schema.ts, but applied to the survey shape so the
  // orchestrator can fail fast before fanning out drafters.
  if (survey.intent === 'agent' && survey.fragments.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fragments'],
      message: `intent="agent" requires exactly one fragment, got ${survey.fragments.length}`,
    });
  }
  if (survey.intent === 'dashboard-existing' && survey.fragments.length !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fragments'],
      message: `intent="dashboard-existing" requires zero fragments, got ${survey.fragments.length}`,
    });
  }
  if (survey.intent === 'dashboard-new' && survey.matchedAgents.length !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['matchedAgents'],
      message: `intent="dashboard-new" requires zero matchedAgents, got ${survey.matchedAgents.length}`,
    });
  }
  if (survey.intent === 'dashboard-mixed') {
    if (survey.matchedAgents.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['matchedAgents'],
        message: `intent="dashboard-mixed" requires at least one matchedAgent`,
      });
    }
    if (survey.fragments.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fragments'],
        message: `intent="dashboard-mixed" requires at least one fragment`,
      });
    }
  }
});

export type Survey = z.output<typeof surveySchema>;
export type SurveyInput = z.input<typeof surveySchema>;

/**
 * Schema for the single-agent output of the agent-drafter agent.
 * Matches one entry of `newAgents[]` in the assembled BuildPlan.
 */
export const draftSchema = z.object({
  id: z.string().regex(AGENT_ID_RE, 'id must be lowercase_with_dashes_or_underscores'),
  purpose: z.string().min(1, 'purpose is required'),
  yaml: z.string().min(1, 'yaml is required'),
});

export type Draft = z.output<typeof draftSchema>;

/**
 * Schema for the dashboard-designer's output. Matches the `dashboard`
 * sub-object in the assembled BuildPlan.
 */
const DASHBOARD_ID_RE = /^user:[a-z0-9][a-z0-9_-]*$/;

export const dashboardDesignSchema = z.object({
  id: z.string().regex(DASHBOARD_ID_RE, 'dashboard.id must start with "user:" followed by lowercase_with_dashes_or_underscores'),
  name: z.string().min(1, 'dashboard.name is required'),
  sections: z.array(z.object({
    title: z.string().min(1, 'sections.title is required'),
    agentIds: z.array(z.string().regex(AGENT_ID_RE, 'sections.agentIds[] must be lowercase_with_dashes_or_underscores')).min(1, 'sections.agentIds must have at least one entry'),
  })).min(1, 'dashboard must have at least one section'),
});

export type DashboardDesign = z.output<typeof dashboardDesignSchema>;

/**
 * Extract a survey JSON string from a raw LLM response. Mirrors
 * `extractPlanJson` from build-plan-schema.ts but looks for
 * `<survey>…</survey>` first. Falls back to bare JSON.
 */
export function extractSurveyJson(raw: string): string | null {
  const surveyTag = /<survey>([\s\S]*?)<\/survey>/i.exec(raw);
  if (surveyTag) return surveyTag[1].trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenced) return fenced[1].trim();

  const bare = raw.trim();
  if (bare.startsWith('{') && bare.endsWith('}')) return bare;

  return null;
}
