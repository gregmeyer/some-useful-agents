/**
 * Typed runtime inputs for agents.
 *
 * YAML declares what an agent expects:
 *
 *   inputs:
 *     ZIP:
 *       type: number
 *       required: true
 *     STYLE:
 *       type: enum
 *       values: [haiku, verse, prose]
 *       default: haiku
 *
 * Callers (CLI `--input KEY=value`, scheduler defaults, chain propagation)
 * supply values. This module merges them with per-agent defaults, validates
 * each against the declared type, and returns a map of strings ready for
 * template substitution or env injection.
 *
 * Strings are the render format regardless of declared type — the type is
 * for *validation at the boundary*, not downstream coercion. A `boolean`
 * input with value `true` renders as the literal string `"true"`.
 */

/** Discriminated shape of a single input's declaration in YAML. */
export interface InputSpec {
  type: 'string' | 'number' | 'boolean' | 'enum';
  /** Closed set of allowed values. Required when `type === 'enum'`. */
  values?: string[];
  /** Default used when the caller supplies nothing. */
  default?: string | number | boolean;
  /** Required: no default + caller didn't supply → error. */
  required?: boolean;
  /** Shown by `sua agent audit`. */
  description?: string;
}

// ── Errors ──────────────────────────────────────────────────────────────

export class MissingInputError extends Error {
  constructor(public readonly input: string, agentName?: string) {
    const where = agentName ? ` for agent "${agentName}"` : '';
    super(
      `Missing required input: ${input}${where}. ` +
        `Pass --input ${input}=<value> on the command line, ` +
        `or add a \`default:\` to the agent's YAML.`,
    );
    this.name = 'MissingInputError';
  }
}

export class InvalidInputTypeError extends Error {
  constructor(
    public readonly input: string,
    public readonly expectedType: InputSpec['type'],
    public readonly receivedValue: string,
    public readonly detail?: string,
  ) {
    super(
      `Invalid value for input "${input}": received ${JSON.stringify(receivedValue)}, ` +
        `expected type ${expectedType}${detail ? ` (${detail})` : ''}.`,
    );
    this.name = 'InvalidInputTypeError';
  }
}

export class UndeclaredInputError extends Error {
  constructor(public readonly input: string, public readonly declared: string[]) {
    super(
      `Input "${input}" was provided but not declared in the agent's \`inputs:\` block. ` +
        `Declared inputs: ${declared.length > 0 ? declared.join(', ') : '(none)'}.`,
    );
    this.name = 'UndeclaredInputError';
  }
}

// ── Validation ──────────────────────────────────────────────────────────

/**
 * Coerce a provided string value to the declared type's rendered form.
 * Throws `InvalidInputTypeError` on type mismatch.
 *
 * The return value is always a string (that's what templates substitute),
 * but we round-trip through native types so we catch bad values at the
 * boundary rather than shipping `"abc"` as the value of a `number` input.
 */
export function validateAndRender(name: string, spec: InputSpec, raw: string): string {
  switch (spec.type) {
    case 'string':
      return raw;
    case 'number': {
      // Number('') and Number(' ') are both 0 in JS — never what the user
      // meant. Reject empty/whitespace explicitly.
      if (raw.trim() === '') {
        throw new InvalidInputTypeError(name, 'number', raw, 'empty string is not a number');
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new InvalidInputTypeError(name, 'number', raw);
      }
      return String(n);
    }
    case 'boolean': {
      const lower = raw.toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(lower)) return 'true';
      if (['false', '0', 'no', 'n'].includes(lower)) return 'false';
      throw new InvalidInputTypeError(
        name,
        'boolean',
        raw,
        'expected true/false/1/0/yes/no',
      );
    }
    case 'enum': {
      if (!spec.values || spec.values.length === 0) {
        throw new InvalidInputTypeError(name, 'enum', raw, 'no allowed values declared');
      }
      if (!spec.values.includes(raw)) {
        throw new InvalidInputTypeError(
          name,
          'enum',
          raw,
          `must be one of ${spec.values.join(', ')}`,
        );
      }
      return raw;
    }
  }
}

/**
 * Stringify a declared default for template substitution. Defaults may be
 * declared as native YAML types (true, 42, "foo"); we render all as strings.
 */
function renderDefault(value: string | number | boolean): string {
  return String(value);
}

// ── Resolution ──────────────────────────────────────────────────────────

export interface ResolveInputsOptions {
  /** Agent name, included in error messages for clarity. Optional. */
  agentName?: string;
  /**
   * When true, providing a value for an input not declared in `specs` is
   * an error. When false, the extra value is silently ignored. Default
   * true — declarations are the contract, extras are usually typos.
   */
  rejectUndeclared?: boolean;
}

/**
 * Given per-agent input specs and a flat map of provided values, return
 * the final resolved map ready for template substitution and env injection.
 *
 * Precedence (highest wins): `provided` → `spec.default` → else throw if required.
 */
export function resolveInputs(
  specs: Record<string, InputSpec> | undefined,
  provided: Record<string, string>,
  options: ResolveInputsOptions = {},
): Record<string, string> {
  const resolved: Record<string, string> = {};
  const declaredNames = Object.keys(specs ?? {});

  // Undeclared provided values: error by default.
  if (options.rejectUndeclared !== false) {
    for (const name of Object.keys(provided)) {
      if (!specs || !(name in specs)) {
        throw new UndeclaredInputError(name, declaredNames);
      }
    }
  }

  if (!specs) return resolved;

  for (const [name, spec] of Object.entries(specs)) {
    const raw = provided[name];
    if (raw !== undefined) {
      resolved[name] = validateAndRender(name, spec, raw);
      continue;
    }
    if (spec.default !== undefined) {
      // Defaults are trusted (they come from the YAML author, not the caller)
      // but we still validate them for self-consistency.
      resolved[name] = validateAndRender(name, spec, renderDefault(spec.default));
      continue;
    }
    // No provided value, no default:
    // - If required, fail.
    // - If the spec implicitly has no default AND no required flag, also fail
    //   (a declared input with neither default nor value is meaningless).
    if (spec.required !== false) {
      throw new MissingInputError(name, options.agentName);
    }
    // If the caller explicitly set required: false and there's no default,
    // the input is genuinely optional — skip it. Templates referencing an
    // optional-and-missing input will render as empty string (handled at
    // substitute time).
  }

  return resolved;
}

// ── Template substitution ───────────────────────────────────────────────

/**
 * Regex matching `{{inputs.NAME}}` where NAME is an uppercase
 * alphanumeric-with-underscore identifier (same rules as env var names).
 */
const INPUT_TEMPLATE_RE = /\{\{inputs\.([A-Z_][A-Z0-9_]*)\}\}/g;

/**
 * Return the set of input names referenced by `{{inputs.X}}` in `text`.
 * Used by the schema loader to validate that every reference has a
 * declaration.
 */
export function extractInputReferences(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(INPUT_TEMPLATE_RE)) {
    names.add(match[1]);
  }
  return names;
}

/**
 * Substitute `{{inputs.X}}` tokens in `text` with values from the resolved
 * map. Missing references render as empty strings — the schema loader is
 * responsible for rejecting templates that reference undeclared inputs.
 */
export function substituteInputs(text: string, resolved: Record<string, string>): string {
  return text.replace(INPUT_TEMPLATE_RE, (_, name) => resolved[name] ?? '');
}
