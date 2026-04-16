import { describe, it, expect } from 'vitest';
import { toolDefinitionSchema } from './tool-schema.js';

describe('toolDefinitionSchema', () => {
  it('accepts a valid shell tool', () => {
    const result = toolDefinitionSchema.safeParse({
      id: 'my-tool',
      name: 'My Tool',
      implementation: { type: 'shell', command: 'echo hi' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid claude-code tool', () => {
    const result = toolDefinitionSchema.safeParse({
      id: 'ai-tool',
      name: 'AI Tool',
      implementation: { type: 'claude-code', prompt: 'Summarise.' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid builtin tool', () => {
    const result = toolDefinitionSchema.safeParse({
      id: 'http-get',
      name: 'HTTP GET',
      source: 'builtin',
      implementation: { type: 'builtin', builtinName: 'http-get' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects tool with invalid id', () => {
    const result = toolDefinitionSchema.safeParse({
      id: 'BAD ID',
      name: 'Bad',
      implementation: { type: 'shell', command: 'echo' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects shell tool without command', () => {
    const result = toolDefinitionSchema.safeParse({
      id: 'bad-shell',
      name: 'Bad Shell',
      implementation: { type: 'shell' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects builtin without builtinName', () => {
    const result = toolDefinitionSchema.safeParse({
      id: 'bad-builtin',
      name: 'Bad Builtin',
      implementation: { type: 'builtin' },
    });
    expect(result.success).toBe(false);
  });

  it('parses inputs and outputs correctly', () => {
    const result = toolDefinitionSchema.safeParse({
      id: 'typed-tool',
      name: 'Typed',
      inputs: {
        url: { type: 'string', required: true },
        timeout: { type: 'number', default: 30 },
      },
      outputs: {
        status: { type: 'number' },
        body: { type: 'json', description: 'Response body.' },
      },
      implementation: { type: 'shell', command: 'curl' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.inputs.url.required).toBe(true);
      expect(result.data.inputs.timeout.default).toBe(30);
      expect(result.data.outputs.body.description).toBe('Response body.');
    }
  });
});
