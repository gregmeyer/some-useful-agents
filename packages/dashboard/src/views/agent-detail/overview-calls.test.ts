import { describe, it, expect } from 'vitest';
import { shortAbout } from './overview.js';

describe('shortAbout', () => {
  it('keeps the first sentence and drops a "Helper for X:" prefix', () => {
    expect(shortAbout('Helper for peer-research: finds founding years. Returns JSON.')).toBe('Finds founding years.');
    expect(shortAbout('Searches Ashby boards. Then filters.')).toBe('Searches Ashby boards.');
  });

  it('does not split on a dot inside a word or number', () => {
    expect(shortAbout('Reads example.com prices at 2.5x speed')).toBe('Reads example.com prices at 2.5x speed');
  });

  it('cuts a long sentence and handles no description', () => {
    expect(shortAbout('x'.repeat(200))).toHaveLength(108);
    expect(shortAbout(undefined)).toBe('');
  });
});
