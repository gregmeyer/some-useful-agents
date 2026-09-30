import type { Agent, EnforcedPolicy } from '@some-useful-agents/core';
import { html, type SafeHtml } from './html.js';
import { PROVIDER_OPTIONS } from './llm-options.js';
import { renderToolsMultipicker, parseToolsField, type PickableTool } from './tools-multipicker.js';

/** Defaults a goal node gets when its budget is left empty (see core goal-node.ts). */
export const GOAL_DEFAULT_MAX_TURNS = 15;
export const GOAL_DEFAULT_TIMEOUT_SEC = 600;

export interface GoalFieldValues {
  goal?: string;
  tools?: readonly string[];
  maxTurns?: number | string;
  timeoutSec?: number | string;
  provider?: string;
  model?: string;
}

export interface ToolsPickerContext {
  tools: PickableTool[];
  policy?: EnforcedPolicy;
  agent: Pick<Agent, 'id' | 'source'>;
}

/**
 * The goal node's fields (form names are `goal*` so they never collide with
 * the llm-prompt fields that share the form): what to achieve, the tools the
 * model may call, the budget, and an optional provider / model.
 */
export function renderGoalFields(args: { values: GoalFieldValues; picker: ToolsPickerContext; paletteSource: string }): SafeHtml {
  const v = args.values;
  const str = (x: number | string | undefined) => (x === undefined ? '' : String(x));
  return html`
    <div class="node-field" data-node-field="goal">
      <div class="form-field">
        <strong>Goal</strong>
        <textarea name="goal" rows="4" placeholder="Find the 3 best-reviewed trail shoes under $150 for {{inputs.RUNNER}} and say why each made the list."
          class="form-field__textarea" data-template-palette="claude" data-palette-source="${args.paletteSource}">${v.goal ?? ''}</textarea>
        <span class="form-field__hint">What to achieve, in plain words. The model works toward it with the tools below until it has an answer or runs out of budget. Type <code>{{</code> for inputs and upstream results.</span>
      </div>

      <div class="form-field">
        <strong>Tools the model may use</strong>
        ${renderToolsMultipicker({
          name: 'goalTools',
          tools: args.picker.tools,
          selected: v.tools ?? [],
          policy: args.picker.policy,
          agent: args.picker.agent,
          idPrefix: 'goal',
          hint: 'Pick at least one. Add ask-human to let it ask you something mid-way.',
        })}
      </div>

      <div class="form-field goal-budget">
        <strong>Budget</strong>
        <div class="goal-budget__row">
          <label class="flex-col text-xs">Turns
            <input type="number" name="goalMaxTurns" min="1" max="50" value="${str(v.maxTurns)}" placeholder="${String(GOAL_DEFAULT_MAX_TURNS)}" class="form-field__input" style="width: 7rem;">
          </label>
          <label class="flex-col text-xs">Seconds
            <input type="number" name="goalTimeoutSec" min="1" value="${str(v.timeoutSec)}" placeholder="${String(GOAL_DEFAULT_TIMEOUT_SEC)}" class="form-field__input" style="width: 7rem;">
          </label>
        </div>
        <span class="form-field__hint">Running out before an answer fails the node as out of budget. Defaults: ${String(GOAL_DEFAULT_MAX_TURNS)} turns, ${String(GOAL_DEFAULT_TIMEOUT_SEC)} seconds.</span>
      </div>

      <div class="form-field">
        <strong>Provider <span class="dim text-xs">(optional)</span></strong>
        <select name="goalProvider" class="form-field__input" style="width: auto;">
          <option value="" ${!v.provider ? 'selected' : ''}>Agent default</option>
          ${PROVIDER_OPTIONS.map((o) => html`<option value="${o.id}" ${v.provider === o.id ? 'selected' : ''}>${o.label}</option>`) as unknown as SafeHtml[]}
        </select>
        <span class="form-field__hint">Needs one that can call tools (Claude, Codex, or an OpenAI-compatible model); Apple Foundation Models is skipped.</span>
      </div>

      <div class="form-field">
        <strong>Model <span class="dim text-xs">(optional)</span></strong>
        <input type="text" name="goalModel" value="${v.model ?? ''}" class="form-field__input" placeholder="Provider default">
      </div>
    </div>`;
}

export interface ParsedGoalFields {
  goal: string;
  tools: string[];
  budget?: { maxTurns?: number; timeoutSec?: number };
  provider?: string;
  model?: string;
}

/**
 * Read and check the goal fields from a form body. Returns the node fields,
 * or an error sentence for the form. `knownTools` / `agentIds` catch a typo'd
 * or removed tool before it fails at run time.
 */
export function parseGoalFields(
  body: Record<string, unknown>,
  check: { currentAgentId: string; isKnownTool: (id: string) => boolean; agentExists: (id: string) => boolean },
): { ok: true; fields: ParsedGoalFields } | { ok: false; error: string; values: GoalFieldValues } {
  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  const tools = parseToolsField(body.goalTools);
  const values: GoalFieldValues = {
    goal,
    tools,
    maxTurns: typeof body.goalMaxTurns === 'string' ? body.goalMaxTurns : undefined,
    timeoutSec: typeof body.goalTimeoutSec === 'string' ? body.goalTimeoutSec : undefined,
    provider: typeof body.goalProvider === 'string' ? body.goalProvider : undefined,
    model: typeof body.goalModel === 'string' ? body.goalModel : undefined,
  };
  const fail = (error: string) => ({ ok: false as const, error, values });
  if (!goal) return fail('A goal node needs a goal: say what it should achieve.');
  if (tools.length === 0) return fail('Pick at least one tool for the goal node. (A goal with no tools is just a prompt; use an LLM prompt node for that.)');
  for (const id of tools) {
    if (id.startsWith('agent:')) {
      const target = id.slice(6);
      if (target === check.currentAgentId) return fail('A goal node can\'t call its own agent.');
      if (!check.agentExists(target)) return fail(`No agent "${target}" to call.`);
    } else if (!check.isKnownTool(id)) {
      return fail(`Unknown tool "${id}".`);
    }
  }
  const int = (raw: string | undefined, min: number, max: number, label: string): number | undefined | string => {
    if (raw === undefined || raw.trim() === '') return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) return `${label} must be a whole number from ${min} to ${max}.`;
    return n;
  };
  const maxTurns = int(values.maxTurns as string | undefined, 1, 50, 'Turns');
  if (typeof maxTurns === 'string') return fail(maxTurns);
  const timeoutSec = int(values.timeoutSec as string | undefined, 1, 86_400, 'Seconds');
  if (typeof timeoutSec === 'string') return fail(timeoutSec);
  const provider = values.provider && PROVIDER_OPTIONS.some((o) => o.id === values.provider) ? values.provider : undefined;
  const model = values.model?.trim() || undefined;
  return {
    ok: true,
    fields: {
      goal,
      tools,
      ...(maxTurns !== undefined || timeoutSec !== undefined ? { budget: { ...(maxTurns !== undefined ? { maxTurns } : {}), ...(timeoutSec !== undefined ? { timeoutSec } : {}) } } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    },
  };
}
