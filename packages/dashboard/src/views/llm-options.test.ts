import { describe, it, expect } from 'vitest';
import { parseLlmOptions } from './llm-options.js';

describe('parseLlmOptions', () => {
  it('returns an empty object for an empty body', () => {
    expect(parseLlmOptions({})).toEqual({});
  });

  it('accepts known providers, rejects others', () => {
    expect(parseLlmOptions({ provider: 'claude' })).toEqual({ provider: 'claude' });
    expect(parseLlmOptions({ provider: 'codex' })).toEqual({ provider: 'codex' });
    expect(parseLlmOptions({ provider: 'gemini' })).toEqual({});
    expect(parseLlmOptions({ provider: '' })).toEqual({});
  });

  it('trims model, omits when empty', () => {
    expect(parseLlmOptions({ model: '  claude-opus-4-7  ' })).toEqual({ model: 'claude-opus-4-7' });
    expect(parseLlmOptions({ model: '   ' })).toEqual({});
    expect(parseLlmOptions({ model: '' })).toEqual({});
  });

  it('parses maxTurns as a positive integer', () => {
    expect(parseLlmOptions({ maxTurns: '5' })).toEqual({ maxTurns: 5 });
    expect(parseLlmOptions({ maxTurns: '0' })).toEqual({});
    expect(parseLlmOptions({ maxTurns: '-1' })).toEqual({});
    expect(parseLlmOptions({ maxTurns: 'abc' })).toEqual({});
    expect(parseLlmOptions({ maxTurns: '' })).toEqual({});
  });

  it('splits allowedTools on commas and whitespace', () => {
    expect(parseLlmOptions({ allowedTools: 'Read, Write, Edit' })).toEqual({ allowedTools: ['Read', 'Write', 'Edit'] });
    expect(parseLlmOptions({ allowedTools: 'Read Write Edit' })).toEqual({ allowedTools: ['Read', 'Write', 'Edit'] });
    expect(parseLlmOptions({ allowedTools: 'Read,Write,  ,Edit' })).toEqual({ allowedTools: ['Read', 'Write', 'Edit'] });
    expect(parseLlmOptions({ allowedTools: '   ' })).toEqual({});
    expect(parseLlmOptions({ allowedTools: '' })).toEqual({});
  });

  it('splits the tools field (registry ids the model may call) independently of allowedTools', () => {
    expect(parseLlmOptions({ tools: 'web-scrape, csv.read.sales, notion.search' })).toEqual({
      tools: ['web-scrape', 'csv.read.sales', 'notion.search'],
    });
    expect(parseLlmOptions({ tools: '   ' })).toEqual({});
  });

  it('combines all fields including the tools list', () => {
    const body = {
      provider: 'codex',
      model: 'gpt-5',
      maxTurns: '10',
      allowedTools: 'Read, web-search',
      tools: 'web-scrape, notion.search',
    };
    expect(parseLlmOptions(body)).toEqual({
      provider: 'codex',
      model: 'gpt-5',
      maxTurns: 10,
      allowedTools: ['Read', 'web-search'],
      tools: ['web-scrape', 'notion.search'],
    });
  });
});
