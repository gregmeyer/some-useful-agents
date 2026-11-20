import { describe, expect, it } from 'vitest';
import { MessageProcessor, STRICT_VALIDATION, basicCatalog } from '../../vendor/a2ui-web-core-v1.mjs';
import { notebookSurfaceData, notebookSurfaceTemplate } from './notebook-surface.js';
import type { NotebookReadoutJson } from '../notebook-readout.js';

const readout = {
  id: 'nb', title: 'Understand A2UI vs AG-UI', for: 'How they differ', status: 'active', archived: false, link: '/notebooks/nb', limits: [], checks: [],
  doneWhen: [{ text: 'The answer written', met: true }, { text: 'Sources outside', met: false }],
  answer: { question: 'q', text: 'A2UI describes; AG-UI carries.', confidence: 'medium', findings: ['A2UI is a spec', 'AG-UI is a protocol'], open: ['Who governs AG-UI?'] },
  options: { inTheRunning: [{ id: 'o1', title: 'Omni · Finance Manager', facts: { Salary: '$170K' }, sources: {}, passed: [], failed: {}, picked: true }], ruledOut: [], more: 0 },
} as unknown as NotebookReadoutJson;

describe('a notebook as an A2UI page for an MCP host (ADR-0090)', () => {
  it("is drawn with A2UI's basic catalog alone: the layout and a notebook's data pass its strict processor", () => {
    const p = new MessageProcessor([basicCatalog], undefined, { validationConfig: STRICT_VALIDATION });
    expect(() => p.processMessages([...notebookSurfaceTemplate(), notebookSurfaceData(readout, 'http://127.0.0.1:3000')])).not.toThrow();
  });

  it('says where it stands, what it rests on, the options, what is open and the done-whens', () => {
    const v = (notebookSurfaceData(readout, 'http://127.0.0.1:3000').updateDataModel as { value: Record<string, unknown> }).value;
    expect(v).toMatchObject({
      title: '## Understand A2UI vs AG-UI', stands: 'Answer · medium confidence', lead: 'A2UI describes; AG-UI carries.',
      rests: [{ text: 'A2UI is a spec' }, { text: 'AG-UI is a protocol' }],
      options: [{ text: '**Omni · Finance Manager** (chosen) · Salary $170K' }],
      open: [{ text: 'Who governs AG-UI?' }],
      done: [{ text: '✓ The answer written' }, { text: '○ Sources outside' }],
      labels: { rests: '**What it rests on**', options: '**In the running** (1)', open: '**Still open**', done: '**Done when**' },
      link: 'http://127.0.0.1:3000/notebooks/nb',
    });
    const bare = (notebookSurfaceData({ ...readout, answer: undefined, options: undefined, doneWhen: [] }).updateDataModel as { value: { labels: Record<string, string> } }).value;
    expect(bare.labels).toEqual({ rests: '', options: '', open: '', done: '' });
  });
});
