import { describe, it, expect } from 'vitest';
import { describeAgentChange } from './agent-change.js';

const yaml = (lines: string[]) => ['id: research', 'name: Research', 'source: local', ...lines].join('\n');

const BEFORE = yaml([
  'inputs:', '  COMPANY:', '    type: string',
  'nodes:',
  '  - id: search', '    type: llm-prompt', '    prompt: "Find {{inputs.COMPANY}}"',
  '  - id: synthesize', '    type: llm-prompt', '    dependsOn: [search]', '    prompt: "Sum up {{upstream.search.result}}"',
  '  - id: tidy', '    type: shell', '    dependsOn: [synthesize]', '    command: echo tidy',
]);

describe('describeAgentChange', () => {
  it('names a new step by the agent it calls, and what runs after what', () => {
    const after = yaml([
      'inputs:', '  COMPANY:', '    type: string', '  REGION:', '    type: string',
      'nodes:',
      '  - id: search', '    type: llm-prompt', '    prompt: "Find {{inputs.COMPANY}}"',
      '  - id: synthesize', '    type: llm-prompt', '    dependsOn: [search]', '    prompt: "Sum up {{upstream.search.result}}"',
      '  - id: enrich', '    type: agent-invoke', '    dependsOn: [synthesize]', '    agentInvokeConfig:', '      agentId: firmographics', '      inputMapping:', '        COMPANY: "{{inputs.COMPANY}}"',
      '  - id: each', '    type: loop', '    dependsOn: [enrich]', '    loopConfig:', '      agentId: per-company', '      over: items',
    ]);
    expect(describeAgentChange(BEFORE, after)).toEqual([
      { what: 'New step', detail: 'enrich calls firmographics, after synthesize' },
      { what: 'New step', detail: 'each runs per-company for each item, after enrich' },
      { what: 'Removed step', detail: 'tidy' },
      { what: 'New input', detail: 'REGION' },
    ]);
  });

  it('says which prompt, command and order changed, and nothing for the same agent', () => {
    const after = BEFORE
      .replace('Sum up {{upstream.search.result}}', 'Summarise { {upstream.search.result}} briefly')
      .replace('echo tidy', 'echo tidier')
      .replace('    dependsOn: [synthesize]', '    dependsOn: [search]');
    expect(describeAgentChange(BEFORE, after)).toEqual([
      { what: 'Prompt', detail: "synthesize's prompt is rewritten" },
      { what: 'Command', detail: "tidy's command changes" },
      { what: 'Order', detail: 'tidy now runs after search' },
    ]);
    expect(describeAgentChange(BEFORE, BEFORE)).toEqual([]);
  });

  it('gives nothing (the diff still shows) when either side does not parse', () => {
    expect(describeAgentChange(BEFORE, 'not: [valid')).toEqual([]);
  });
});
