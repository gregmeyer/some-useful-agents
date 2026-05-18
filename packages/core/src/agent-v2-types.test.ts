import { describe, it, expect } from 'vitest';
import { isLlmPromptType } from './agent-v2-types.js';

describe('isLlmPromptType', () => {
  it('returns true for the canonical llm-prompt spelling', () => {
    expect(isLlmPromptType('llm-prompt')).toBe(true);
  });

  it('returns true for the legacy claude-code spelling', () => {
    expect(isLlmPromptType('claude-code')).toBe(true);
  });

  it('returns false for other node types', () => {
    expect(isLlmPromptType('shell')).toBe(false);
    expect(isLlmPromptType('file-write')).toBe(false);
    expect(isLlmPromptType('conditional')).toBe(false);
  });

  it('returns false for missing or empty input', () => {
    expect(isLlmPromptType(undefined)).toBe(false);
    expect(isLlmPromptType(null)).toBe(false);
    expect(isLlmPromptType('')).toBe(false);
  });
});
