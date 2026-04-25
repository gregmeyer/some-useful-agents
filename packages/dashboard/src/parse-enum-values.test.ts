import { describe, it, expect } from 'vitest';
import { parseEnumValues } from './routes/agent-nodes.js';

describe('parseEnumValues', () => {
  it('parses comma-separated values with trimming + dedupe', () => {
    expect(parseEnumValues('a, b, c')).toEqual(['a', 'b', 'c']);
    expect(parseEnumValues('a, a, b,, c')).toEqual(['a', 'b', 'c']);
    expect(parseEnumValues('')).toEqual([]);
    expect(parseEnumValues('   ')).toEqual([]);
  });

  it('parses a JSON array form', () => {
    expect(parseEnumValues('["one","two"]')).toEqual(['one', 'two']);
    expect(parseEnumValues('[  "x",  "y" , "x"]')).toEqual(['x', 'y']);
  });

  it('falls back to comma split when JSON parse fails', () => {
    expect(parseEnumValues('[broken, json')).toEqual(['[broken', 'json']);
  });
});
