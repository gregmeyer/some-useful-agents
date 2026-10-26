import { describe, it, expect } from 'vitest';
import { toOpenAiFunctionSchema, resolveExposedTools } from './llm-tools.js';
import { getBuiltinTool } from './builtin-tools.js';

describe('toOpenAiFunctionSchema', () => {
  it('maps a builtin definition to an OpenAI function schema', () => {
    const def = getBuiltinTool('web-fetch')!.definition;
    const fn = toOpenAiFunctionSchema(def);
    expect(fn.type).toBe('function');
    expect(fn.function.name).toBe('web-fetch');
    expect(fn.function.parameters.type).toBe('object');
    expect(fn.function.parameters.additionalProperties).toBe(false);
    expect(fn.function.parameters.properties.url).toEqual(expect.objectContaining({ type: 'string' }));
    expect(fn.function.parameters.required).toContain('url'); // url is required
  });

  it('json-typed inputs become an open schema', () => {
    const fn = toOpenAiFunctionSchema(getBuiltinTool('json-path')!.definition);
    // `data` is json-typed: any value, so no restrictive `type`; `path` stays a string.
    expect(fn.function.parameters.properties.data).not.toHaveProperty('type');
    expect(fn.function.parameters.properties.path).toEqual(expect.objectContaining({ type: 'string' }));
  });
});

describe('resolveExposedTools', () => {
  it('keeps only real builtin ids, de-duplicated and order-preserving', () => {
    const tools = resolveExposedTools(['web-scrape', 'not-a-tool', 'web-fetch', 'web-scrape', 'Bash']);
    expect(tools.map((t) => t.function.name)).toEqual(['web-scrape', 'web-fetch']);
  });
  it('returns [] for empty/undefined', () => {
    expect(resolveExposedTools(undefined)).toEqual([]);
    expect(resolveExposedTools([])).toEqual([]);
  });
});
