import { describe, it, expect } from 'vitest';
import {
  resolveInputs,
  validateAndRender,
  extractInputReferences,
  substituteInputs,
  SENSITIVE_ENV_NAMES,
  MissingInputError,
  InvalidInputTypeError,
  UndeclaredInputError,
  type InputSpec,
} from './input-resolver.js';

describe('validateAndRender', () => {
  it('passes strings through unchanged', () => {
    expect(validateAndRender('X', { type: 'string' }, 'hello')).toBe('hello');
    expect(validateAndRender('X', { type: 'string' }, '')).toBe('');
  });

  it('validates numbers and renders as decimal string', () => {
    expect(validateAndRender('X', { type: 'number' }, '42')).toBe('42');
    expect(validateAndRender('X', { type: 'number' }, '3.14')).toBe('3.14');
    expect(validateAndRender('X', { type: 'number' }, '-0')).toBe('0');
  });

  it('rejects non-numeric values for number type', () => {
    expect(() => validateAndRender('X', { type: 'number' }, 'abc')).toThrow(
      InvalidInputTypeError,
    );
    expect(() => validateAndRender('X', { type: 'number' }, '')).toThrow(
      InvalidInputTypeError,
    );
  });

  it('accepts true/false/1/0/yes/no for boolean', () => {
    for (const truthy of ['true', 'True', 'TRUE', '1', 'yes', 'Y']) {
      expect(validateAndRender('X', { type: 'boolean' }, truthy)).toBe('true');
    }
    for (const falsy of ['false', 'False', '0', 'no', 'N']) {
      expect(validateAndRender('X', { type: 'boolean' }, falsy)).toBe('false');
    }
  });

  it('rejects ambiguous boolean values', () => {
    expect(() => validateAndRender('X', { type: 'boolean' }, 'maybe')).toThrow(
      InvalidInputTypeError,
    );
  });

  it('accepts declared enum values', () => {
    const spec: InputSpec = { type: 'enum', values: ['haiku', 'verse', 'prose'] };
    expect(validateAndRender('X', spec, 'haiku')).toBe('haiku');
    expect(validateAndRender('X', spec, 'verse')).toBe('verse');
  });

  it('rejects undeclared enum values', () => {
    const spec: InputSpec = { type: 'enum', values: ['haiku', 'verse'] };
    expect(() => validateAndRender('X', spec, 'limerick')).toThrow(InvalidInputTypeError);
  });

  it('rejects enum without values array', () => {
    const spec = { type: 'enum' } as InputSpec;
    expect(() => validateAndRender('X', spec, 'anything')).toThrow(InvalidInputTypeError);
  });
});

describe('resolveInputs', () => {
  it('returns empty map when no specs are declared', () => {
    expect(resolveInputs(undefined, {})).toEqual({});
  });

  it('applies YAML defaults when caller omits a value', () => {
    const specs: Record<string, InputSpec> = {
      ZIP: { type: 'number', default: 94110 },
      STYLE: { type: 'enum', values: ['haiku'], default: 'haiku' },
    };
    expect(resolveInputs(specs, {})).toEqual({ ZIP: '94110', STYLE: 'haiku' });
  });

  it('caller-supplied values override defaults', () => {
    const specs: Record<string, InputSpec> = {
      ZIP: { type: 'number', default: 94110 },
    };
    expect(resolveInputs(specs, { ZIP: '10001' })).toEqual({ ZIP: '10001' });
  });

  it('throws MissingInputError when required and no default', () => {
    const specs: Record<string, InputSpec> = { ZIP: { type: 'number', required: true } };
    expect(() => resolveInputs(specs, {})).toThrow(MissingInputError);
  });

  it('implicit required: no required flag, no default → still required', () => {
    const specs: Record<string, InputSpec> = { ZIP: { type: 'number' } };
    expect(() => resolveInputs(specs, {})).toThrow(MissingInputError);
  });

  it('respects explicit required:false (input skipped when omitted)', () => {
    const specs: Record<string, InputSpec> = { ZIP: { type: 'number', required: false } };
    expect(resolveInputs(specs, {})).toEqual({});
  });

  it('throws InvalidInputTypeError for bad values', () => {
    const specs: Record<string, InputSpec> = { ZIP: { type: 'number' } };
    expect(() => resolveInputs(specs, { ZIP: 'abc' })).toThrow(InvalidInputTypeError);
  });

  it('rejects undeclared provided keys by default', () => {
    const specs: Record<string, InputSpec> = { ZIP: { type: 'number', default: 0 } };
    expect(() => resolveInputs(specs, { EXTRA: 'value' })).toThrow(UndeclaredInputError);
  });

  it('tolerates undeclared provided keys with rejectUndeclared:false', () => {
    const specs: Record<string, InputSpec> = { ZIP: { type: 'number', default: 0 } };
    const result = resolveInputs(
      specs,
      { EXTRA: 'value', ZIP: '10' },
      { rejectUndeclared: false },
    );
    expect(result).toEqual({ ZIP: '10' });
  });

  it('validates defaults themselves (catches YAML author typos)', () => {
    const specs: Record<string, InputSpec> = {
      STYLE: { type: 'enum', values: ['haiku'], default: 'limerick' },
    };
    expect(() => resolveInputs(specs, {})).toThrow(InvalidInputTypeError);
  });

  it('includes agent name in missing-input error message', () => {
    const specs: Record<string, InputSpec> = { ZIP: { type: 'number', required: true } };
    try {
      resolveInputs(specs, {}, { agentName: 'weather-verse' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingInputError);
      expect((err as Error).message).toContain('weather-verse');
    }
  });
});

describe('SENSITIVE_ENV_NAMES', () => {
  it('includes dynamic-loader injection vectors', () => {
    expect(SENSITIVE_ENV_NAMES.has('LD_PRELOAD')).toBe(true);
    expect(SENSITIVE_ENV_NAMES.has('LD_LIBRARY_PATH')).toBe(true);
    expect(SENSITIVE_ENV_NAMES.has('DYLD_INSERT_LIBRARIES')).toBe(true);
    expect(SENSITIVE_ENV_NAMES.has('DYLD_LIBRARY_PATH')).toBe(true);
  });

  it('includes interpreter-startup injection vectors', () => {
    expect(SENSITIVE_ENV_NAMES.has('NODE_OPTIONS')).toBe(true);
    expect(SENSITIVE_ENV_NAMES.has('NODE_PATH')).toBe(true);
    expect(SENSITIVE_ENV_NAMES.has('PYTHONPATH')).toBe(true);
    expect(SENSITIVE_ENV_NAMES.has('PYTHONSTARTUP')).toBe(true);
    expect(SENSITIVE_ENV_NAMES.has('RUBYOPT')).toBe(true);
    expect(SENSITIVE_ENV_NAMES.has('PERL5OPT')).toBe(true);
  });

  it('includes shell hijack vectors', () => {
    expect(SENSITIVE_ENV_NAMES.has('PATH')).toBe(true);
    expect(SENSITIVE_ENV_NAMES.has('SHELL')).toBe(true);
    expect(SENSITIVE_ENV_NAMES.has('BASH_ENV')).toBe(true);
    expect(SENSITIVE_ENV_NAMES.has('PROMPT_COMMAND')).toBe(true);
    expect(SENSITIVE_ENV_NAMES.has('IFS')).toBe(true);
  });

  it('does not accidentally include benign names', () => {
    expect(SENSITIVE_ENV_NAMES.has('ZIP')).toBe(false);
    expect(SENSITIVE_ENV_NAMES.has('STYLE')).toBe(false);
    expect(SENSITIVE_ENV_NAMES.has('MY_API_TOKEN')).toBe(false);
    expect(SENSITIVE_ENV_NAMES.has('FOO')).toBe(false);
  });
});

describe('extractInputReferences', () => {
  it('finds {{inputs.X}} references in a string', () => {
    const text = 'Weather for {{inputs.ZIP}} in {{inputs.STYLE}} please.';
    expect([...extractInputReferences(text)].sort()).toEqual(['STYLE', 'ZIP']);
  });

  it('returns empty set when no references', () => {
    expect(extractInputReferences('no templates').size).toBe(0);
    expect(extractInputReferences('').size).toBe(0);
  });

  it('deduplicates repeated references', () => {
    const text = '{{inputs.X}} and {{inputs.X}} again';
    expect([...extractInputReferences(text)]).toEqual(['X']);
  });

  it('ignores malformed-looking references', () => {
    expect(extractInputReferences('{{inputs.lowercase}}').size).toBe(0);
    expect(extractInputReferences('{{input.SINGULAR}}').size).toBe(0);
  });
});

describe('substituteInputs', () => {
  it('replaces tokens with provided values', () => {
    expect(substituteInputs('zip={{inputs.ZIP}}', { ZIP: '94110' })).toBe('zip=94110');
  });

  it('handles multiple tokens in one string', () => {
    const text = '{{inputs.A}} and {{inputs.B}}';
    expect(substituteInputs(text, { A: 'foo', B: 'bar' })).toBe('foo and bar');
  });

  it('missing key renders as empty string', () => {
    expect(substituteInputs('{{inputs.MISSING}}', {})).toBe('');
  });

  it('passes non-template text through unchanged', () => {
    expect(substituteInputs('plain text', {})).toBe('plain text');
  });
});
