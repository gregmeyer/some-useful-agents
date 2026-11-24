/**
 * One card that points several agents at a shared tool (docs/tools.md,
 * ADR-0103): a new tool (or one you have) and an edit for each agent that
 * then calls it. Approving it saves everything or nothing:
 *  - everything is checked first: the tool (as `sua tool add` would), and
 *    each edit (lib/agent-edit.ts: the right agent, not moved on since,
 *    using only tools that exist or this one, its declared outputs kept);
 *  - then the tool is saved, then each agent as a new version;
 *  - a save that fails undoes the ones before it, in reverse.
 */
import {
  checkUserToolYaml,
  saveUserTool,
  type ToolDefinition,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { parseAgentEdit, prepareAgentEdit, applyAgentEdit, toolIdsUsed, preservedNote, type Parsed } from './agent-edit.js';
import type { Agent } from '@some-useful-agents/core';

type Ctx = ReturnType<typeof getContext>;

/** The id of the card that applies a shared tool. */
export const TOOL_REFACTOR_APPLY = 'tool-refactor-apply';

export interface RefactorEdit {
  agentId: string;
  /** The version the edit was made from; the card refuses if the agent moved on. */
  baseVersion: number;
  /** The agent's YAML at that version (the diff's left side). */
  baseYaml: string;
  /** The whole new definition. */
  yaml: string;
}

export interface ToolRefactorCard {
  /** The tool to save (new, or replacing yours), or empty when reusing one. */
  toolYaml: string;
  /** The YAML of the tool it replaces, or empty for a new tool. */
  toolBase: string;
  /** A tool you have, used as it is (no `toolYaml`). */
  reuseToolId: string;
  edits: RefactorEdit[];
  leftOut: Array<{ agentId: string; why: string }>;
}

/** The card's inputs (TOOL_YAML, TOOL_BASE, REUSE_TOOL, EDITS, LEFT_OUT) read back. Pure. */
export function readToolRefactorInputs(inputs: Record<string, string | undefined>): ToolRefactorCard | { error: string } {
  let edits: unknown;
  let leftOut: unknown = [];
  try { edits = JSON.parse(inputs.EDITS ?? '[]'); } catch { return { error: "The card's agent changes can't be read." }; }
  try { if (inputs.LEFT_OUT) leftOut = JSON.parse(inputs.LEFT_OUT); } catch { leftOut = []; }
  if (!Array.isArray(edits) || edits.length === 0) return { error: 'The card changes no agents.' };
  const ok = edits.every((e) => e && typeof e === 'object'
    && typeof (e as RefactorEdit).agentId === 'string'
    && typeof (e as RefactorEdit).yaml === 'string'
    && typeof (e as RefactorEdit).baseYaml === 'string'
    && Number.isFinite((e as RefactorEdit).baseVersion));
  if (!ok) return { error: "The card's agent changes can't be read." };
  const toolYaml = inputs.TOOL_YAML ?? '';
  const reuseToolId = inputs.REUSE_TOOL ?? '';
  if (!toolYaml.trim() && !reuseToolId) return { error: 'The card has no tool.' };
  return {
    toolYaml,
    toolBase: inputs.TOOL_BASE ?? '',
    reuseToolId,
    edits: edits as RefactorEdit[],
    leftOut: Array.isArray(leftOut) ? (leftOut as Array<{ agentId: string; why: string }>).filter((x) => x && typeof x.agentId === 'string') : [],
  };
}

interface CheckedRefactor {
  /** The tool to save, or undefined when reusing one. */
  tool?: ToolDefinition;
  toolId: string;
  /** The tool as it is now, when saving replaces it. */
  replacing?: ToolDefinition;
  agents: Array<{ parsed: Parsed; before?: Agent; preserved: string[] }>;
}

const sameKeys = (a: object | undefined, b: object | undefined): boolean => {
  const ka = Object.keys(a ?? {}).sort().join(',');
  const kb = Object.keys(b ?? {}).sort().join(',');
  return ka === kb;
};

/**
 * One agent's change on the card, checked as it will be saved: the shared
 * edit checks with every tool required to exist (or be `toolId`), using
 * `toolId`, still installed, and giving back the same outputs.
 */
export function checkRefactorEdit(
  ctx: Ctx,
  edit: Pick<RefactorEdit, 'agentId' | 'yaml' | 'baseVersion'>,
  toolId: string,
): { ok: true; value: { parsed: Parsed; before?: Agent; preserved: string[] } } | { ok: false; reason: string } {
  const read = parseAgentEdit(ctx, edit.agentId, edit.yaml, { checkTools: true, pendingTools: [toolId] });
  if (!read.ok) return { ok: false, reason: read.reason };
  const { parsed, repairedYaml } = read.value;
  if (!toolIdsUsed(parsed).includes(toolId)) return { ok: false, reason: `The change to \`${edit.agentId}\` doesn't use \`${toolId}\`.` };
  const cutShort = readsToolResultCutShort(parsed, toolId);
  if (cutShort) return { ok: false, reason: `In the change to \`${edit.agentId}\`, step "${cutShort.step}" reads the tool's result from $${cutShort.name}, which holds only its first 32 KB, so a large result breaks. Read it with upstream_json("${cutShort.toolStep}") from sua_helpers (python3), or from "$${cutShort.name}_FILE".` };
  const current = ctx.agentStore.getAgent(edit.agentId);
  if (!current) return { ok: false, reason: `\`${edit.agentId}\` isn't installed any more.` };
  if (!sameKeys(current.outputs, parsed.outputs)) {
    return { ok: false, reason: `The change to \`${edit.agentId}\` would change what it gives back (its outputs), which a shared tool shouldn't.` };
  }
  const ready = prepareAgentEdit(ctx, parsed, repairedYaml, edit.baseVersion);
  if (!ready.ok) return { ok: false, reason: ready.reason };
  return { ok: true, value: { parsed, before: ready.value.before, preserved: ready.value.preserved } };
}

/**
 * A shell step that reads a tool step's result from \`$UPSTREAM_<ID>_RESULT\`
 * (cut at 32 KB in the environment) instead of its \`_FILE\` or
 * sua_helpers' upstream(): the first such step, or undefined. Pure.
 */
export function readsToolResultCutShort(agent: Pick<Parsed, 'nodes'>, toolId: string): { step: string; toolStep: string; name: string } | undefined {
  for (const t of agent.nodes.filter((n) => n.tool === toolId)) {
    const name = `UPSTREAM_${t.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_RESULT`;
    const bare = new RegExp(`${name}(?!_FILE)`);
    for (const n of agent.nodes) {
      if (n.type === 'shell' && !n.tool && n.command && bare.test(n.command)) return { step: n.id, toolStep: t.id, name };
    }
  }
  return undefined;
}

/** Everything checked, nothing saved. The reasons it can't be applied, or what to save. */
export function checkToolRefactor(ctx: Ctx, card: ToolRefactorCard): { ok: true; value: CheckedRefactor } | { ok: false; reasons: string[] } {
  if (!ctx.toolStore) return { ok: false, reasons: ["The tool store isn't available here."] };
  const reasons: string[] = [];
  let tool: ToolDefinition | undefined;
  let replacing: ToolDefinition | undefined;
  let toolId = card.reuseToolId;
  if (card.toolYaml.trim()) {
    const checked = checkUserToolYaml(card.toolYaml, ctx.toolStore);
    if (!checked.tool) return { ok: false, reasons: checked.errors.map((e) => `The tool: ${e}`) };
    tool = checked.tool;
    toolId = tool.id;
    const now = ctx.toolStore.getTool(toolId);
    if (!card.toolBase.trim() && now) {
      reasons.push(`There's a tool \`${toolId}\` now that wasn't there when this was proposed. Ask sua to look again.`);
    } else if (card.toolBase.trim()) {
      if (!now) reasons.push(`The tool \`${toolId}\` this replaces is gone. Ask sua to look again.`);
      else if ((now.yamlText ?? '') !== card.toolBase) reasons.push(`The tool \`${toolId}\` changed since this was proposed. Ask sua to look again.`);
      else replacing = now;
    }
  } else if (!ctx.toolStore.getTool(toolId)) {
    reasons.push(`The tool \`${toolId}\` is gone. Ask sua to look again.`);
  }

  const agents: CheckedRefactor['agents'] = [];
  const seen = new Set<string>();
  for (const edit of card.edits) {
    if (seen.has(edit.agentId)) { reasons.push(`\`${edit.agentId}\` is changed twice on this card.`); continue; }
    seen.add(edit.agentId);
    const one = checkRefactorEdit(ctx, edit, toolId);
    if (!one.ok) { reasons.push(one.reason); continue; }
    agents.push(one.value);
  }
  if (reasons.length) return { ok: false, reasons };
  return { ok: true, value: { tool, toolId, replacing, agents } };
}

/** Check, then save the tool and every agent; all or nothing. */
export function applyToolRefactor(ctx: Ctx, card: ToolRefactorCard): { status: 'completed' | 'failed'; summary?: string; refusalReason?: string } {
  const checked = checkToolRefactor(ctx, card);
  if (!checked.ok) {
    return { status: 'failed', refusalReason: `Nothing was changed. ${checked.reasons.join(' ')}` };
  }
  const { tool, toolId, replacing, agents } = checked.value;
  const undos: Array<() => void> = [];
  const undoAll = () => {
    for (const u of undos.reverse()) {
      try { u(); } catch { /* keep undoing the rest */ }
    }
  };
  try {
    if (tool) {
      saveUserTool(ctx.toolStore!, card.toolYaml);
      undos.push(replacing
        ? () => { ctx.toolStore!.updateTool(replacing, replacing.yamlText); }
        : () => { ctx.toolStore!.deleteTool(toolId); });
    }
    const lines: string[] = [];
    for (const a of agents) {
      const from = a.before?.version;
      const saved = applyAgentEdit(ctx, a.parsed, a.before, `Points at the shared tool ${toolId} (sua)`);
      undos.push(saved.undo);
      lines.push(`\`${a.parsed.id}\` v${String(from ?? '?')} → v${String(saved.version)}${preservedNote(a.preserved)}`);
    }
    const head = tool
      ? `${replacing ? 'Updated' : 'Added'} the tool \`${toolId}\` and changed ${agents.length} agent${agents.length === 1 ? '' : 's'} to use it`
      : `Changed ${agents.length} agent${agents.length === 1 ? '' : 's'} to use your tool \`${toolId}\``;
    const left = card.leftOut.length ? ` Left out: ${card.leftOut.map((l) => `\`${l.agentId}\` (${l.why})`).join(', ')}.` : '';
    return {
      status: 'completed',
      summary: `${head}: ${lines.join('; ')}. To go back, restore an agent's previous version from its Versions page.${left}`,
    };
  } catch (err) {
    undoAll();
    return { status: 'failed', refusalReason: `Nothing was changed (it was undone): ${err instanceof Error ? err.message : String(err)}` };
  }
}
