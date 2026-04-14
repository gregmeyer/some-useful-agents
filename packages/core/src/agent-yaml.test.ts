import { describe, it, expect } from 'vitest';
import { parseAgent, exportAgent, AgentYamlParseError } from './agent-yaml.js';
import type { Agent } from './agent-v2-types.js';

const MINIMAL_YAML = `
id: hello
name: Hello
description: A greeter
nodes:
  - id: main
    type: shell
    command: echo hi
`;

const THREE_NODE_YAML = `
id: news-digest
name: News Digest
description: Daily AI news digest
status: active
schedule: "0 9 * * *"
source: local
mcp: false
version: 2
inputs:
  TOPIC:
    type: string
    default: ai
nodes:
  - id: fetch
    type: shell
    command: curl -s https://news.example.com
  - id: summarize
    type: claude-code
    prompt: |
      Summarize these headlines: {{upstream.fetch.result}}
    allowedTools:
      - WebFetch
    dependsOn:
      - fetch
  - id: post
    type: shell
    command: echo published
    secrets:
      - SLACK_WEBHOOK
    dependsOn:
      - summarize
`;

describe('parseAgent', () => {
  it('parses a minimal single-node agent', () => {
    const a = parseAgent(MINIMAL_YAML);
    expect(a.id).toBe('hello');
    expect(a.nodes).toHaveLength(1);
    expect(a.nodes[0].command).toBe('echo hi');
    // Defaults applied:
    expect(a.status).toBe('draft');
    expect(a.source).toBe('local');
    expect(a.version).toBe(1);
  });

  it('parses a three-node DAG with inputs and dependencies', () => {
    const a = parseAgent(THREE_NODE_YAML);
    expect(a.nodes).toHaveLength(3);
    expect(a.nodes[1].dependsOn).toEqual(['fetch']);
    expect(a.nodes[2].secrets).toEqual(['SLACK_WEBHOOK']);
    expect(a.inputs?.TOPIC?.default).toBe('ai');
  });

  it('throws AgentYamlParseError on empty input', () => {
    expect(() => parseAgent('')).toThrow(AgentYamlParseError);
    expect(() => parseAgent('   \n  \n')).toThrow(AgentYamlParseError);
  });

  it('throws AgentYamlParseError on invalid YAML', () => {
    expect(() => parseAgent('id: [[[')).toThrow(AgentYamlParseError);
  });

  it('throws AgentYamlParseError with all issues on schema failure', () => {
    try {
      parseAgent(`
id: BadId
name: X
nodes:
  - id: phantom-ref
    type: shell
    command: echo hi
    dependsOn: [ghost]
`);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentYamlParseError);
      const issues = (err as AgentYamlParseError).issues as Array<{ message: string }>;
      expect(issues).toBeDefined();
      expect(issues.some((i) => /lowercase/i.test(i.message))).toBe(true);
      expect(issues.some((i) => /dependsOn "ghost"/.test(i.message))).toBe(true);
    }
  });
});

describe('exportAgent + round-trip', () => {
  it('round-trips a three-node agent losslessly', () => {
    const a1 = parseAgent(THREE_NODE_YAML);
    const yaml = exportAgent(a1);
    const a2 = parseAgent(yaml);
    // Deep equality is the bar; serialization is allowed to reshape whitespace.
    expect(a2).toEqual(a1);
  });

  it('round-trips a minimal agent losslessly', () => {
    const a1 = parseAgent(MINIMAL_YAML);
    const a2 = parseAgent(exportAgent(a1));
    expect(a2).toEqual(a1);
  });

  it('emits fields in stable order (id, name, description, ... nodes, ...)', () => {
    const a = parseAgent(THREE_NODE_YAML);
    const yaml = exportAgent(a);

    // Find the line indices of the agent-level top-level keys. They should
    // appear in the order declared by AGENT_KEY_ORDER.
    const lines = yaml.split('\n');
    const order = ['id:', 'name:', 'description:', 'status:', 'schedule:', 'source:', 'mcp:', 'version:', 'inputs:', 'nodes:'];
    let lastIndex = -1;
    for (const key of order) {
      const idx = lines.findIndex((l) => l.startsWith(key));
      if (idx === -1) continue; // optional field
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it('emits node fields in stable order (id, type, command|prompt, ... dependsOn)', () => {
    const a: Agent = {
      id: 'x',
      name: 'X',
      status: 'active',
      source: 'local',
      mcp: false,
      version: 1,
      nodes: [
        {
          id: 'n1',
          type: 'shell',
          command: 'echo hi',
          timeout: 30,
          secrets: ['MY_KEY'],
          dependsOn: [],
        },
      ],
    };
    const yaml = exportAgent(a);
    // id must appear before type, type before command, command before secrets, etc.
    const idPos = yaml.indexOf('- id: n1');
    const typePos = yaml.indexOf('type: shell');
    const cmdPos = yaml.indexOf('command: echo hi');
    const secretsPos = yaml.indexOf('secrets:');
    expect(idPos).toBeLessThan(typePos);
    expect(typePos).toBeLessThan(cmdPos);
    expect(cmdPos).toBeLessThan(secretsPos);
  });

  it('omits undefined fields from the output', () => {
    const a = parseAgent(MINIMAL_YAML);
    const yaml = exportAgent(a);
    // Minimal agent has no schedule, no inputs, no tags — none should appear.
    expect(yaml).not.toMatch(/^schedule:/m);
    expect(yaml).not.toMatch(/^inputs:/m);
    expect(yaml).not.toMatch(/^tags:/m);
  });

  it('preserves node-level position hint for the v0.14 editor', () => {
    const yaml = `
id: laid-out
name: Laid out
nodes:
  - id: a
    type: shell
    command: echo 1
    position:
      x: 120
      y: 60
  - id: b
    type: shell
    command: echo 2
    dependsOn: [a]
    position:
      x: 300
      y: 60
`;
    const a1 = parseAgent(yaml);
    expect(a1.nodes[0].position).toEqual({ x: 120, y: 60 });
    const a2 = parseAgent(exportAgent(a1));
    expect(a2.nodes[0].position).toEqual({ x: 120, y: 60 });
    expect(a2.nodes[1].position).toEqual({ x: 300, y: 60 });
  });

  it('handles multi-line prompts with block scalars cleanly', () => {
    const yaml = `
id: multi
name: Multi
nodes:
  - id: c
    type: claude-code
    prompt: |
      Line one
      Line two
      Line three
`;
    const a1 = parseAgent(yaml);
    expect(a1.nodes[0].prompt).toBe('Line one\nLine two\nLine three\n');
    const a2 = parseAgent(exportAgent(a1));
    expect(a2.nodes[0].prompt).toBe('Line one\nLine two\nLine three\n');
  });
});
