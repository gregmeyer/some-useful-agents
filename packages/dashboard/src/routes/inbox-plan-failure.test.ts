import { describe, it, expect } from 'vitest';
import { triageFailureWords } from './inbox-plan.js';

describe("sua's reply when it couldn't answer", () => {
  it('says why, in words, and what to do: a busy model is not your request', () => {
    expect(triageFailureWords([{ provider: 'codex', category: 'model_busy', model: 'gpt-6-sol' }])).toBe(
      "I couldn't answer: Codex (OpenAI) on gpt-6-sol is busy: the model is at capacity on their side right now (your usage isn't used up). Nothing is wrong with your request. Say \"try again\" in a few minutes, or pick another model (or a fallback for when it's busy) in Settings → LLM.",
    );
    expect(triageFailureWords([
      { provider: 'codex', category: 'model_busy', model: 'gpt-6-sol' },
      { provider: 'local-qwen-8b', category: 'binary_missing' },
      { provider: 'claude', category: 'auth_required' },
    ])).toContain("; local-qwen-8b isn't installed or isn't running; and then Claude needs you to sign in again.");
  });

  it('keeps the old reply when nothing explains it', () => {
    expect(triageFailureWords([])).toBeUndefined();
    expect(triageFailureWords([{ provider: 'codex', category: 'other', error: 'boom' }])).toBeUndefined();
  });
});
