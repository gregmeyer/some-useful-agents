import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { autoFixYaml } from './run-now-build.js';

function fix(yaml: string): Record<string, unknown> {
  return parseYaml(autoFixYaml(yaml)) as Record<string, unknown>;
}

describe('autoFixYaml — outputWidget field aliases (Bug 12 from dogfood)', () => {
  it('rewrites field with name=label + source=jsonKey by swapping', () => {
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
outputWidget:
  type: key-value
  fields:
    - name: Stories Fetched
      source: count
      type: text
`.trim());
    const fields = (fixed.outputWidget as Record<string, unknown>).fields as Array<Record<string, unknown>>;
    expect(fields[0].name).toBe('count');
    expect(fields[0].label).toBe('Stories Fetched');
    expect(fields[0].source).toBeUndefined();
  });

  it('rewrites path: → name: when name is missing', () => {
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
outputWidget:
  type: key-value
  fields:
    - path: file
      type: code
`.trim());
    const fields = (fixed.outputWidget as Record<string, unknown>).fields as Array<Record<string, unknown>>;
    expect(fields[0].name).toBe('file');
    expect(fields[0].path).toBeUndefined();
  });

  it('rewrites from: and key: too', () => {
    for (const alias of ['from', 'key']) {
      const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
outputWidget:
  type: key-value
  fields:
    - name: My Label
      ${alias}: actual_key
      type: text
`.trim());
      const fields = (fixed.outputWidget as Record<string, unknown>).fields as Array<Record<string, unknown>>;
      expect(fields[0].name).toBe('actual_key');
      expect(fields[0].label).toBe('My Label');
      expect(fields[0][alias]).toBeUndefined();
    }
  });

  it('strips dot-prefix like output.foo → foo', () => {
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
outputWidget:
  type: key-value
  fields:
    - name: Temp
      source: output.current_temp
      type: metric
`.trim());
    const fields = (fixed.outputWidget as Record<string, unknown>).fields as Array<Record<string, unknown>>;
    expect(fields[0].name).toBe('current_temp');
  });
});

describe('autoFixYaml — signal.template fallback (Bug 3 from dogfood)', () => {
  it('rewrites unknown signal template to text-headline', () => {
    // 'bar-chart' isn't in the signal template registry (it's a widget type
    // confused for a signal template — a real LLM mistake from dogfood).
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
signal:
  title: X
  template: bar-chart
  format: text
`.trim());
    expect((fixed.signal as Record<string, unknown>).template).toBe('text-headline');
  });

  it('keeps valid templates untouched', () => {
    for (const t of ['metric', 'time-series', 'text-headline', 'table', 'status']) {
      const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
signal:
  title: X
  template: ${t}
  format: text
`.trim());
      expect((fixed.signal as Record<string, unknown>).template).toBe(t);
    }
  });
});

describe('autoFixYaml — signal.title expression syntax (Bug from round-3 dogfood)', () => {
  it('strips JSEP-style expression to first quoted segment', () => {
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
signal:
  title: "'Weather: ' + output.city"
  template: text-headline
  format: text
`.trim());
    expect((fixed.signal as Record<string, unknown>).title).toBe('Weather');
  });

  it('leaves plain string titles alone', () => {
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
signal:
  title: HN Top Stories
  template: text-headline
  format: text
`.trim());
    expect((fixed.signal as Record<string, unknown>).title).toBe('HN Top Stories');
  });
});

describe('autoFixYaml — signal.mapping non-string values (Bug from final dogfood)', () => {
  it('rewrites array mapping value to "result"', () => {
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
signal:
  title: X
  template: key-value
  format: json
  mapping:
    pairs:
      - label: a
        value: 1
      - label: b
        value: 2
`.trim());
    expect((fixed.signal as Record<string, unknown>).mapping)
      .toMatchObject({ pairs: 'result' });
  });

  it('keeps string mapping values untouched', () => {
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
signal:
  title: X
  template: key-value
  format: json
  mapping:
    pairs: forecast_pairs
    title: city
`.trim());
    expect((fixed.signal as Record<string, unknown>).mapping)
      .toMatchObject({ pairs: 'forecast_pairs', title: 'city' });
  });
});

describe('autoFixYaml — outputWidget.title invented field (Bug from dogfood)', () => {
  it('strips outputWidget.title silently', () => {
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
outputWidget:
  type: key-value
  title: This is not a real field
  fields:
    - name: result
      type: text
`.trim());
    expect(fixed.outputWidget).not.toHaveProperty('title');
    expect((fixed.outputWidget as Record<string, unknown>).type).toBe('key-value');
  });
});

describe('autoFixYaml — claude-code template syntax (existing fix, regression test)', () => {
  it('repairs { { → {{ in claude-code prompts', () => {
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: ask
    type: claude-code
    prompt: |
      Hello { {inputs.NAME}}, here is { {upstream.fetch.result}}.
`.trim());
    const nodes = fixed.nodes as Array<Record<string, unknown>>;
    expect(nodes[0].prompt).toContain('{{inputs.NAME}}');
    expect(nodes[0].prompt).toContain('{{upstream.fetch.result}}');
    expect(nodes[0].prompt).not.toContain('{ {');
  });
});

describe('autoFixYaml — outputs shorthand promotion', () => {
  it('promotes bare-string outputs to { type: ... } objects', () => {
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
outputs:
  url: string
  count: number
  ok: boolean
  meta: object
  items: array
`.trim());
    expect(fixed.outputs).toEqual({
      url: { type: 'string' },
      count: { type: 'number' },
      ok: { type: 'boolean' },
      meta: { type: 'object' },
      items: { type: 'array' },
    });
  });

  it('leaves verbose-form outputs untouched', () => {
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
outputs:
  count:
    type: number
    description: How many stories.
`.trim());
    expect(fixed.outputs).toEqual({
      count: { type: 'number', description: 'How many stories.' },
    });
  });

  it('rescues description-strings the LLM put in the type slot', () => {
    // The analyzer/builder LLM frequently emits free-text descriptions in
    // the value slot ("YouTube watch URL") because the catalog says
    // "documentation for the planner". Coerce to a string-typed entry
    // with the description preserved, instead of failing validation.
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
outputs:
  url: YouTube watch URL
  birthday: ISO date
`.trim());
    expect(fixed.outputs).toEqual({
      url: { type: 'string', description: 'YouTube watch URL' },
      birthday: { type: 'string', description: 'ISO date' },
    });
  });

  it('snake_cases camelCase output keys', () => {
    const fixed = fix(`
id: x
name: X
source: local
nodes:
  - id: main
    type: shell
    command: echo hi
outputs:
  mediaType: string
  embedUrl: Embeddable iframe URL
`.trim());
    expect(fixed.outputs).toEqual({
      media_type: { type: 'string' },
      embed_url: { type: 'string', description: 'Embeddable iframe URL' },
    });
  });
});
