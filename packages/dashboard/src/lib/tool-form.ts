/**
 * The New tool / Edit tool form: its fields to the tool's YAML and back.
 * The YAML is what's saved (core `saveUserTool`), so the form and `sua tool
 * add` save the same thing. See docs/tools.md "Tools you add".
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ToolDefinition } from '@some-useful-agents/core';

export const TOOL_FIELD_TYPES = ['string', 'number', 'boolean', 'json', 'array', 'object'] as const;
type FieldType = typeof TOOL_FIELD_TYPES[number];

export interface ToolFormInput {
  name: string;
  type: FieldType;
  required: boolean;
  default: string;
  description: string;
}

export interface ToolFormOutput {
  name: string;
  type: FieldType;
  description: string;
}

export interface ToolFormValues {
  id: string;
  name: string;
  description: string;
  kind: 'command' | 'prompt';
  /** The command (kind command) or the prompt (kind prompt). */
  body: string;
  inputs: ToolFormInput[];
  outputs: ToolFormOutput[];
}

export const EMPTY_TOOL_FORM: ToolFormValues = {
  id: '', name: '', description: '', kind: 'command', body: '',
  inputs: [{ name: '', type: 'string', required: true, default: '', description: '' }],
  outputs: [],
};

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined ? [] : [String(v)]);
const one = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : v === undefined ? '' : String(v));
const fieldType = (v: string): FieldType => ((TOOL_FIELD_TYPES as readonly string[]).includes(v) ? v as FieldType : 'string');

/** The form's fields from a posted body (`in_name`, `in_type`, … repeat once per row). */
export function toolFormFromBody(body: Record<string, unknown>): ToolFormValues {
  const inNames = list(body.in_name);
  const inTypes = list(body.in_type);
  const inReq = list(body.in_required);
  const inDefaults = list(body.in_default);
  const inDescs = list(body.in_description);
  const outNames = list(body.out_name);
  const outTypes = list(body.out_type);
  const outDescs = list(body.out_description);
  return {
    id: one(body.id).trim(),
    name: one(body.name).trim(),
    description: one(body.description).trim(),
    kind: one(body.kind) === 'prompt' ? 'prompt' : 'command',
    body: one(body.body).replace(/\r\n/g, '\n'),
    inputs: inNames.map((name, i) => ({
      name: name.trim(),
      type: fieldType(inTypes[i] ?? 'string'),
      required: inReq[i] === 'yes',
      default: inDefaults[i] ?? '',
      description: (inDescs[i] ?? '').trim(),
    })).filter((r) => r.name || r.default || r.description),
    outputs: outNames.map((name, i) => ({
      name: name.trim(),
      type: fieldType(outTypes[i] ?? 'string'),
      description: (outDescs[i] ?? '').trim(),
    })).filter((r) => r.name || r.description),
  };
}

function typedDefault(type: FieldType, raw: string): string | number | boolean {
  if (type === 'number' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
  if (type === 'boolean' && (raw === 'true' || raw === 'false')) return raw === 'true';
  return raw;
}

/** The tool's YAML from the form's fields. */
export function toolFormToYaml(v: ToolFormValues): string {
  const doc: Record<string, unknown> = { id: v.id, name: v.name || v.id };
  if (v.description) doc.description = v.description;
  const inputs: Record<string, unknown> = {};
  for (const i of v.inputs) {
    const spec: Record<string, unknown> = { type: i.type };
    if (i.required) spec.required = true;
    if (i.default !== '') spec.default = typedDefault(i.type, i.default);
    if (i.description) spec.description = i.description;
    inputs[i.name] = spec;
  }
  doc.inputs = inputs;
  const outputs: Record<string, unknown> = {};
  for (const o of v.outputs) outputs[o.name] = o.description ? { type: o.type, description: o.description } : { type: o.type };
  if (v.outputs.length) doc.outputs = outputs;
  doc.implementation = v.kind === 'prompt'
    ? { type: 'llm-prompt', prompt: v.body }
    : { type: 'shell', command: v.body.endsWith('\n') ? v.body : `${v.body}\n` };
  return stringifyYaml(doc, { lineWidth: 0 });
}

/** The form's fields for a saved tool. */
export function toolFormFromTool(t: ToolDefinition): ToolFormValues {
  const isPrompt = t.implementation.type === 'llm-prompt' || t.implementation.type === 'claude-code';
  return {
    id: t.id,
    name: t.name,
    description: t.description ?? '',
    kind: isPrompt ? 'prompt' : 'command',
    body: (isPrompt ? t.implementation.prompt : t.implementation.command) ?? '',
    inputs: Object.entries(t.inputs ?? {}).map(([name, s]) => ({
      name,
      type: fieldType(s.type),
      required: !!s.required,
      default: s.default === undefined ? '' : String(s.default),
      description: s.description ?? '',
    })),
    outputs: Object.entries(t.outputs ?? {}).map(([name, s]) => ({ name, type: fieldType(s.type), description: s.description ?? '' })),
  };
}

/** The form's fields from YAML, or why they can't be (the YAML doesn't parse). */
export function toolFormFromYaml(yamlText: string): ToolFormValues | { error: string } {
  let raw: unknown;
  try { raw = parseYaml(yamlText); } catch (err) { return { error: `The YAML doesn't parse: ${(err as Error).message.split('\n')[0]}` }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'A tool is a YAML mapping with id, name, inputs and implementation.' };
  const r = raw as Record<string, unknown>;
  const impl = (r.implementation ?? {}) as Record<string, unknown>;
  return toolFormFromTool({
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    description: r.description === undefined ? undefined : String(r.description),
    source: 'local',
    inputs: (r.inputs ?? {}) as ToolDefinition['inputs'],
    outputs: (r.outputs ?? {}) as ToolDefinition['outputs'],
    implementation: {
      type: impl.type === 'llm-prompt' || impl.type === 'claude-code' ? 'llm-prompt' : 'shell',
      command: typeof impl.command === 'string' ? impl.command : undefined,
      prompt: typeof impl.prompt === 'string' ? impl.prompt : undefined,
    },
  });
}

/** Sample inputs for Try it, written as `name: value` lines (YAML). */
export function parseSampleInputs(text: string): Record<string, unknown> | { error: string } {
  if (!text.trim()) return {};
  let raw: unknown;
  try { raw = parseYaml(text); } catch (err) { return { error: `The sample inputs don't parse: ${(err as Error).message.split('\n')[0]}` }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Write the sample inputs as name: value, one per line.' };
  return raw as Record<string, unknown>;
}
