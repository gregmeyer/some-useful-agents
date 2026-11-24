/**
 * A tool you add (a command or a prompt, kept in the tool store) gets its
 * inputs here, the same way whether a `tool:` node or a model calls it.
 *
 * Only the inputs the tool declares are accepted. Defaults fill gaps, a
 * missing required input is an error, and each value is a string by the time
 * it reaches the tool. A command tool gets each input as an environment
 * variable named as it's declared (`$url`), never pasted into the command,
 * so a value can't become shell syntax. A prompt tool gets `{{inputs.x}}`
 * replaced in its prompt. See ADR-0102.
 */
import { SENSITIVE_ENV_NAMES } from './input-resolver.js';
import type { ToolDefinition } from './tool-types.js';

/** An input name a command tool can use: a valid environment variable name. */
export const TOOL_INPUT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The most a single input value may be, in characters. Large text belongs in a file. */
export const TOOL_INPUT_MAX_CHARS = 32_000;

const SENSITIVE_LOWER = new Set([...SENSITIVE_ENV_NAMES].map((n) => n.toLowerCase()));
const RESERVED_EXACT = new Set(['state_dir', 'tmpdir', 'pwd', 'oldpwd', 'term']);
const RESERVED_PREFIXES = ['upstream_', 'sua_', 'bash_func', 'git_', 'npm_config_'];

/** Why a command tool can't use this input name, or undefined when it can. */
export function reservedToolInputName(name: string): string | undefined {
  if (!TOOL_INPUT_NAME_RE.test(name)) {
    return `"${name}" can't be an input name: use letters, digits and _ (not starting with a digit).`;
  }
  const lower = name.toLowerCase();
  if (SENSITIVE_LOWER.has(lower) || RESERVED_EXACT.has(lower)) {
    return `"${name}" can't be an input name: the command's environment already uses it.`;
  }
  if (lower.endsWith('_proxy')) {
    return `"${name}" can't be an input name: it would change where the command's network requests go.`;
  }
  const prefix = RESERVED_PREFIXES.find((p) => lower.startsWith(p));
  if (prefix) {
    return `"${name}" can't be an input name: names starting with ${prefix.toUpperCase()} are used by sua and the tools it runs.`;
  }
  return undefined;
}

/** A command or prompt tool kept in the tool store (not MCP, not built in). */
export function isUserRunTool(def: Pick<ToolDefinition, 'implementation'>): boolean {
  const t = def.implementation.type;
  return t === 'shell' || t === 'llm-prompt' || t === 'claude-code';
}

export function isCommandTool(def: Pick<ToolDefinition, 'implementation'>): boolean {
  return def.implementation.type === 'shell';
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return '';
  return JSON.stringify(v);
}

/**
 * The values a tool is called with: declared inputs only, defaults applied,
 * required ones present, each a string. Throws ToolInputError otherwise.
 */
export function resolveToolCallInputs(
  def: Pick<ToolDefinition, 'id' | 'inputs'>,
  given: Record<string, unknown>,
): Record<string, string> {
  const declared = def.inputs ?? {};
  const unknown = Object.keys(given).filter((k) => !(k in declared));
  if (unknown.length > 0) {
    const names = Object.keys(declared);
    throw new ToolInputError(
      `Tool "${def.id}" has no input ${unknown.map((k) => `"${k}"`).join(', ')}` +
        (names.length ? ` (its inputs: ${names.join(', ')}).` : ' (it takes no inputs).'),
    );
  }
  const out: Record<string, string> = {};
  for (const [name, field] of Object.entries(declared)) {
    const raw = given[name] !== undefined && given[name] !== null && given[name] !== '' ? given[name] : field.default;
    if (raw === undefined) {
      if (field.required) throw new ToolInputError(`Tool "${def.id}" needs its "${name}" input.`);
      continue;
    }
    const text = asText(raw);
    if (text.length > TOOL_INPUT_MAX_CHARS) {
      throw new ToolInputError(
        `Tool "${def.id}": the "${name}" input is ${text.length.toLocaleString('en-US')} characters, over the ${TOOL_INPUT_MAX_CHARS.toLocaleString('en-US')} a tool input can be. Pass a file path instead.`,
      );
    }
    out[name] = text;
  }
  return out;
}

/**
 * The environment a command tool runs with: the node's environment, then the
 * tool's inputs. An input may not replace a secret the node declared.
 */
export function commandToolEnv(
  def: Pick<ToolDefinition, 'id'>,
  baseEnv: Record<string, string>,
  values: Record<string, string>,
  secretNames: readonly string[] = [],
): Record<string, string> {
  const secrets = new Set(secretNames);
  for (const name of Object.keys(values)) {
    const reason = reservedToolInputName(name);
    if (reason) throw new ToolInputError(`Tool "${def.id}": ${reason}`);
    if (secrets.has(name)) {
      throw new ToolInputError(`Tool "${def.id}": its "${name}" input has the same name as a secret this step uses. Rename the input.`);
    }
  }
  return { ...baseEnv, ...values };
}

const PROMPT_INPUT_RE = /\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** A prompt tool's prompt with `{{inputs.x}}` replaced; an input it wasn't given becomes empty. */
export function substituteToolPrompt(prompt: string, values: Record<string, string>): string {
  return prompt.replace(PROMPT_INPUT_RE, (_m, name: string) => values[name] ?? '');
}

/** Problems that stop a command or prompt tool from being saved. */
export function userToolErrors(def: Pick<ToolDefinition, 'implementation' | 'inputs'>): string[] {
  if (!isCommandTool(def)) return [];
  const errors: string[] = [];
  for (const name of Object.keys(def.inputs ?? {})) {
    const reason = reservedToolInputName(name);
    if (reason) errors.push(reason);
  }
  return errors;
}

/**
 * Things worth a second look before keeping a tool. They warn; they don't
 * stop the save. Shown by `sua tool add`, the dashboard form and the drafter.
 */
export function userToolWarnings(def: Pick<ToolDefinition, 'implementation' | 'inputs'>): string[] {
  const warnings: string[] = [];
  const inputs = Object.keys(def.inputs ?? {});
  if (isCommandTool(def)) {
    const cmd = def.implementation.command ?? '';
    for (const name of inputs) {
      // $name or ${name} outside double quotes: word splitting and option injection.
      const unquoted = new RegExp(`(^|[^"\\w])\\$\\{?${name}\\}?(?![\\w])`, 'm');
      const lines = cmd.split('\n').map((l) => l.replace(/"[^"]*"/g, '""'));
      if (lines.some((l) => unquoted.test(l))) {
        warnings.push(`$${name} is used without quotes. Write "$${name}" so a value with spaces or a leading - can't change the command.`);
      }
      // $name, ${name}, or read by name (os.environ["name"] in a python3 one-liner).
      if (!new RegExp(`\\b${name}\\b`).test(cmd)) {
        warnings.push(`The command never uses its "${name}" input ($${name}).`);
      }
    }
    if (/\beval\b/.test(cmd) || /\b(ba|z)?sh\s+-c\s+"?\$/.test(cmd)) {
      warnings.push('The command runs text as code (eval or sh -c with a variable). An input could then run anything.');
    }
    if (/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r|\bsudo\b/.test(cmd)) {
      warnings.push('The command deletes files recursively or uses sudo.');
    }
    const fetchesInput = inputs.some((n) => new RegExp(`\\b(curl|wget)\\b[^\\n]*\\$\\{?${n}\\b`).test(cmd));
    if (fetchesInput) {
      warnings.push("curl or wget fetches a URL from an input, so it can reach file:// and this machine's own network. For a plain fetch, the http-get tool checks the address first.");
    }
  } else if (isUserRunTool(def)) {
    const prompt = def.implementation.prompt ?? '';
    for (const name of inputs) {
      if (!new RegExp(`\\{\\{\\s*inputs\\.${name}\\s*\\}\\}`).test(prompt)) {
        warnings.push(`The prompt never uses its "${name}" input ({{inputs.${name}}}).`);
      }
    }
  }
  return warnings;
}

/** Anything that can look a stored tool up by id (the tool store, or a trial's drafts in front of it). */
export interface ToolLookup {
  getTool(id: string): ToolDefinition | undefined;
}

function toolRunsShell(id: string, tools?: ToolLookup): boolean {
  if (id === 'shell-exec') return true;
  return tools?.getTool(id)?.implementation.type === 'shell';
}

/**
 * Whether running this node can start a shell: a shell node, a node whose
 * tool is shell-exec or a command tool (whatever its `type:` says), or a
 * model step whose `tools:` list offers one. The community shell gate uses it.
 */
export function nodeRunsShell(
  node: { type?: string; tool?: string; tools?: readonly string[] },
  tools?: ToolLookup,
): boolean {
  if (node.type === 'shell') return true;
  if (node.tool && toolRunsShell(node.tool, tools)) return true;
  return (node.tools ?? []).some((t) => toolRunsShell(t, tools));
}
