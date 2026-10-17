import { describe, it, expect } from 'vitest';
import { factsOf, isEmptyValue, keyLabel, recordColumns, recordsOf } from './result-shape.js';

describe('reading output as what it is', () => {
  it('knows an empty value', () => {
    for (const v of ['', ' ', '[]', '{}', 'null', '—', undefined]) expect(isEmptyValue(v)).toBe(true);
    for (const v of ['0', 'none found', '[1]']) expect(isEmptyValue(v)).toBe(false);
  });

  it('a JSON list of records becomes rows; anything else does not', () => {
    expect(recordsOf('```json\n[{"a":1,"b":["x","y"]},{"a":2,"c":{"d":1}}]\n```')).toEqual([{ a: '1', b: 'x, y' }, { a: '2', c: '{"d":1}' }]);
    expect(recordsOf('[1,2]')).toBeUndefined();
    expect(recordsOf('[]')).toBeUndefined();
    expect(recordsOf('not json')).toBeUndefined();
    expect(recordColumns([{ name: 'A', link: 'https://a.example' }, { name: 'B', link: '' }])).toEqual([{ key: 'name', label: 'Name' }, { key: 'link', label: 'Link', format: 'link' }]);
    expect(keyLabel('source_url')).toBe('Source url');
    expect(keyLabel('whyBuy')).toBe('Why buy');
  });

  it('a JSON object reads as labelled facts, an empty one saying so', () => {
    expect(factsOf('{"url": "", "status": "blocked", "tags": ["a", "b"]}')).toEqual([
      { label: 'Url', value: '(empty)' }, { label: 'Status', value: 'blocked' }, { label: 'Tags', value: 'a, b' },
    ]);
    expect(factsOf('[{"a":1}]')).toBeUndefined();
    expect(factsOf('Found 2 roles.')).toBeUndefined();
  });
});
