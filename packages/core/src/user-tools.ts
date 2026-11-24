/**
 * Adding, updating and removing a tool you made: one path for `sua tool add`,
 * the dashboard's New tool form and sua's tool drafter. A tool you add is a
 * command or a prompt (MCP tools come in through Import, built-ins ship with
 * sua). See ADR-0102.
 */
import { parse as parseYaml } from 'yaml';
import { toolDefinitionSchema } from './tool-schema.js';
import { getBuiltinTool } from './builtin-tools.js';
import { isUserRunTool, userToolErrors, userToolWarnings } from './user-tool-inputs.js';
import type { ToolStore } from './tool-store.js';
import type { ToolDefinition } from './tool-types.js';

export interface CheckedUserTool {
  /** Set when the tool can be saved. */
  tool?: ToolDefinition;
  /** Why it can't be saved. */
  errors: string[];
  /** Worth a second look; the tool can still be saved. */
  warnings: string[];
}

/**
 * Check a tool's YAML: it parses, matches the tool schema, is a command or a
 * prompt, uses input names a command can have, and doesn't take a built-in's
 * id or an MCP-imported tool's. Pure apart from reading the store.
 */
export function checkUserToolYaml(yamlText: string, store?: Pick<ToolStore, 'getTool' | 'getToolServerId'>): CheckedUserTool {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    return { errors: [`The YAML doesn't parse: ${(err as Error).message}`], warnings: [] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['A tool is a YAML mapping with id, name, inputs and implementation.'], warnings: [] };
  }
  // A tool you add is always yours, whatever the file says.
  const parsed = toolDefinitionSchema.safeParse({ ...(raw as Record<string, unknown>), source: 'local' });
  if (!parsed.success) {
    return {
      errors: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)),
      warnings: [],
    };
  }
  const tool = parsed.data as ToolDefinition;
  const errors: string[] = [];
  if (!isUserRunTool(tool)) {
    errors.push(
      tool.implementation.type === 'mcp'
        ? 'MCP tools are added with Import from an MCP server (Tools → Import), not as a file.'
        : 'A tool you add runs a command (implementation type: shell) or a prompt (type: llm-prompt).',
    );
  }
  if (tool.implementation.type === 'shell' && !(tool.implementation.command ?? '').trim()) errors.push('The command is empty.');
  if (tool.implementation.type !== 'shell' && isUserRunTool(tool) && !(tool.implementation.prompt ?? '').trim()) errors.push('The prompt is empty.');
  if (getBuiltinTool(tool.id)) errors.push(`"${tool.id}" is the id of a built-in tool. Choose another id.`);
  if (store?.getTool(tool.id) && store.getToolServerId(tool.id)) {
    errors.push(`"${tool.id}" is a tool imported from an MCP server. Choose another id.`);
  }
  errors.push(...userToolErrors(tool));
  return errors.length ? { errors, warnings: [] } : { tool, errors: [], warnings: userToolWarnings(tool) };
}

export class UserToolError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(' '));
    this.name = 'UserToolError';
  }
}

/**
 * Save a tool you made from its YAML: create it, or replace the one with the
 * same id. Throws UserToolError with the reasons when it can't be saved.
 */
export function saveUserTool(
  store: ToolStore,
  yamlText: string,
): { tool: ToolDefinition; created: boolean; warnings: string[] } {
  const checked = checkUserToolYaml(yamlText, store);
  if (!checked.tool) throw new UserToolError(checked.errors);
  const existing = store.getTool(checked.tool.id);
  if (existing && !isUserRunTool(existing)) {
    throw new UserToolError([`"${checked.tool.id}" is already a tool of another kind. Choose another id.`]);
  }
  const tool = existing ? store.updateTool(checked.tool, yamlText) : store.createTool(checked.tool, yamlText);
  return { tool, created: !existing, warnings: checked.warnings };
}

/** Remove a tool you made. MCP-imported tools go with their server; built-ins can't be removed. */
export function removeUserTool(store: ToolStore, id: string): void {
  assertRemovableUserTool(store, id);
  store.deleteTool(id);
}

/** Throws UserToolError unless `id` is a tool you added (so it can be removed). */
export function assertRemovableUserTool(store: Pick<ToolStore, 'getTool' | 'getToolServerId'>, id: string): void {
  if (getBuiltinTool(id)) throw new UserToolError([`"${id}" is a built-in tool and can't be removed.`]);
  const tool = store.getTool(id);
  if (!tool) throw new UserToolError([`There's no tool "${id}".`]);
  if (store.getToolServerId(id) || !isUserRunTool(tool)) {
    throw new UserToolError([`"${id}" was imported from an MCP server. Remove the server under Tools → Servers instead.`]);
  }
}

/** Ids of the agents with a step that uses this tool, as its `tool:` or in its `tools:` list. */
export function agentsUsingTool(
  agents: Iterable<{ id: string; nodes?: ReadonlyArray<{ tool?: string; tools?: readonly string[] }> }>,
  toolId: string,
): string[] {
  const out: string[] = [];
  for (const a of agents) {
    if ((a.nodes ?? []).some((n) => n.tool === toolId || (n.tools ?? []).includes(toolId))) out.push(a.id);
  }
  return out;
}

/** Tool ids an agent's steps use (`tool:` and `tools:`), without `agent:` calls. Pure. */
export function toolIdsUsed(agent: { nodes: ReadonlyArray<{ tool?: string; tools?: readonly string[] }> }): string[] {
  const ids = new Set<string>();
  for (const n of agent.nodes) {
    if (n.tool) ids.add(n.tool);
    for (const t of n.tools ?? []) if (!t.startsWith('agent:')) ids.add(t);
  }
  return [...ids];
}
