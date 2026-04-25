/**
 * Pure-data catalog for the Output Widget editor UI.
 *
 * Three maps consumed by renderOutputWidgetEditor + output-widget-editor.js:
 *   - WIDGET_TYPES: descriptions, ASCII hints, compatible field types
 *   - FIELD_TYPES:  descriptions + which widget types they make sense in
 *   - EXAMPLE_WIDGETS: curated starters the user can load in one click
 */

import type { OutputWidgetSchema } from '@some-useful-agents/core';

export type WidgetType = 'raw' | 'key-value' | 'diff-apply' | 'dashboard' | 'ai-template';
export type FieldType = 'text' | 'code' | 'badge' | 'action' | 'metric' | 'stat' | 'preview';

export interface WidgetTypeInfo {
  name: WidgetType;
  displayName: string;
  /** One-line description for the card. */
  description: string;
  /** ASCII/text sketch showing how the widget arranges fields. */
  layoutHint: string;
  /**
   * Field types that actually have a visual effect under this widget.
   * Types not listed are "advisory-dimmed" in the picker.
   */
  compatibleFields: FieldType[];
  /** Sentence shown under the picker when this widget is selected. */
  helperCopy: string;
}

export const WIDGET_TYPES: Record<WidgetType, WidgetTypeInfo> = {
  raw: {
    name: 'raw',
    displayName: 'Raw',
    description: 'Labelled sections of the run output — good default for anything text-heavy.',
    layoutHint: 'Headline\nBody text…\n\nStatus: badge',
    compatibleFields: ['text', 'code', 'badge', 'preview'],
    helperCopy: 'Each field becomes a titled section. Use for reports, logs, or a single preview panel — just add one field with type preview pointing at the output file.',
  },
  'key-value': {
    name: 'key-value',
    displayName: 'Key-value',
    description: 'Definition list of label/value pairs. Compact. Great for summaries.',
    layoutHint: 'Total:     42\nPassed:    40\nFailed:    2 (badge)',
    compatibleFields: ['text', 'badge'],
    helperCopy: 'Each field renders as Label: Value. Keep fields short and numeric where possible. Perfect for test-result summaries, counts, status rollups.',
  },
  'diff-apply': {
    name: 'diff-apply',
    displayName: 'Diff apply',
    description: 'Classification pill + diff view + action buttons. Used by agent-analyzer.',
    layoutHint: '[ SAFE ]\nSummary of the change\n— diff panel —\n[Apply] [Reject]',
    compatibleFields: ['text', 'code', 'badge', 'action'],
    helperCopy: 'Specialized for review/approve workflows. Extract fields named classification (badge), summary (text), details (code/diff), and optionally yaml. Actions render as POST buttons.',
  },
  dashboard: {
    name: 'dashboard',
    displayName: 'Dashboard',
    description: 'Hero metrics up top, compact stats below, text sections underneath.',
    layoutHint: '┌────┐ ┌────┐\n│ 42 │ │ 12 │\n└────┘ └────┘\n  stat  stat\nBody text…',
    compatibleFields: ['text', 'code', 'badge', 'metric', 'stat', 'preview'],
    helperCopy: 'Use metric for headline numbers (rendered large) and stat for the compact row below. Any text/code/badge fields render beneath in order. Best for run scorecards and KPI summaries.',
  },
  'ai-template': {
    name: 'ai-template',
    displayName: 'AI template ✨',
    description: 'Describe the layout in plain English. Claude generates an HTML template; we sanitize and reuse it for every run.',
    layoutHint: 'You: "card with score, status pill,\n      and a sparkline of the\n      last 7 results"\n         ↓\nClaude → sanitized HTML\n         ↓\nrendered against {{outputs.X}}',
    compatibleFields: [],
    helperCopy: 'Write a description of how the run output should look. Click Generate — Claude returns HTML with {{outputs.NAME}} placeholders that get substituted at render time. Sanitized to a safe tag/attr allowlist before storage.',
  },
};

export interface FieldTypeInfo {
  name: FieldType;
  description: string;
  /** Widget types this field type meaningfully applies to. */
  validIn: WidgetType[];
}

export const FIELD_TYPES: Record<FieldType, FieldTypeInfo> = {
  text: {
    name: 'text',
    description: 'Plain paragraph. Wraps and respects whitespace.',
    validIn: ['raw', 'key-value', 'diff-apply', 'dashboard'],
  },
  code: {
    name: 'code',
    description: 'Monospaced preformatted block — good for logs, JSON, diffs.',
    validIn: ['raw', 'diff-apply', 'dashboard'],
  },
  badge: {
    name: 'badge',
    description: 'Inline pill. Keep values short ("ok", "failed", "3 errors").',
    validIn: ['raw', 'key-value', 'diff-apply', 'dashboard'],
  },
  action: {
    name: 'action',
    description: 'POST button wired to the widget\u2019s declared actions. Only used by diff-apply today.',
    validIn: ['diff-apply'],
  },
  metric: {
    name: 'metric',
    description: 'Hero number + label. Renders large at the top of a dashboard.',
    validIn: ['dashboard'],
  },
  stat: {
    name: 'stat',
    description: 'Compact stat card in the row below the hero metrics.',
    validIn: ['dashboard'],
  },
  preview: {
    name: 'preview',
    description: 'Value must be a file path. Renders HTML in an iframe or images inline.',
    validIn: ['raw', 'dashboard'],
  },
};

/** Starter widgets that populate the editor in one click. */
export const EXAMPLE_WIDGETS: Record<string, { label: string; description: string; schema: OutputWidgetSchema }> = {
  'report-card': {
    label: 'Report card',
    description: 'Headline + body + status. Good default for any agent that produces a summary.',
    schema: {
      type: 'dashboard',
      fields: [
        { name: 'headline', type: 'metric', label: 'Headline' },
        { name: 'body', type: 'text', label: 'Body' },
        { name: 'status', type: 'badge', label: 'Status' },
      ],
    },
  },
  'metric-dashboard': {
    label: 'Metric dashboard',
    description: 'Two hero metrics, three supporting stats. For KPI-style runs.',
    schema: {
      type: 'dashboard',
      fields: [
        { name: 'primary_metric', type: 'metric', label: 'Primary' },
        { name: 'secondary_metric', type: 'metric', label: 'Secondary' },
        { name: 'total', type: 'stat', label: 'Total' },
        { name: 'passed', type: 'stat', label: 'Passed' },
        { name: 'failed', type: 'stat', label: 'Failed' },
      ],
    },
  },
  'file-preview': {
    label: 'File preview',
    description: 'Single preview field — renders HTML/images the agent wrote to disk.',
    schema: {
      type: 'raw',
      fields: [
        { name: 'output_path', type: 'preview', label: 'Preview' },
      ],
    },
  },
  'diff-applier': {
    label: 'Diff applier',
    description: 'Classification badge + summary + diff details. Used by review-style agents.',
    schema: {
      type: 'diff-apply',
      fields: [
        { name: 'classification', type: 'badge', label: 'Classification' },
        { name: 'summary', type: 'text', label: 'Summary' },
        { name: 'details', type: 'code', label: 'Details' },
      ],
    },
  },
  'key-value-summary': {
    label: 'Key-value summary',
    description: 'Compact label/value rollup — test results, counts, status checks.',
    schema: {
      type: 'key-value',
      fields: [
        { name: 'total', type: 'text', label: 'Total' },
        { name: 'completed', type: 'text', label: 'Completed' },
        { name: 'failed', type: 'badge', label: 'Failed' },
      ],
    },
  },
};

/**
 * Build a fake JSON blob where every declared field maps to a plausible
 * value for its type. Used by the preview route to feed renderOutputWidget.
 */
export function synthPreviewOutput(fields: Array<{ name: string; type: FieldType }>): string {
  const payload: Record<string, unknown> = {};
  for (const f of fields) {
    payload[f.name] = sampleValueFor(f.type, f.name);
  }
  return JSON.stringify(payload, null, 2);
}

function sampleValueFor(type: FieldType, name: string): string | number {
  switch (type) {
    case 'metric':
    case 'stat':
      return 42;
    case 'badge':
      return 'ready';
    case 'code':
      return `// sample ${name}\n{ "ok": true }`;
    case 'preview':
      return '/sample/preview.html';
    case 'action':
      return 'Run';
    case 'text':
    default:
      return `Sample ${name} value. This is what your tile will show when the agent emits a real value.`;
  }
}
