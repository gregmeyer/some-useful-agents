/**
 * Pulse display template registry, backward-compat normalization,
 * and multi-field value extraction.
 */

import type { AgentSignal, SignalTemplate, Run } from '@some-useful-agents/core';

// ── Template registry ────────────────────────────────────────────────────

export interface TemplateSlot {
  name: string;
  label: string;
  required: boolean;
  type: 'string' | 'number' | 'url' | 'array' | 'boolean';
}

export interface TemplateDefinition {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  slots: TemplateSlot[];
  defaultSize: '1x1' | '2x1' | '1x2' | '2x2';
}

export const TEMPLATE_REGISTRY: Record<string, TemplateDefinition> = {
  metric: {
    name: 'metric',
    displayName: 'Metric',
    description: 'Big number with label and unit',
    icon: '#',
    slots: [
      { name: 'value', label: 'Value', required: true, type: 'number' },
      { name: 'label', label: 'Label', required: false, type: 'string' },
      { name: 'unit', label: 'Unit', required: false, type: 'string' },
      { name: 'previous', label: 'Previous value', required: false, type: 'number' },
    ],
    defaultSize: '1x1',
  },
  'time-series': {
    name: 'time-series',
    displayName: 'Time Series',
    description: 'Sparkline chart with current value',
    icon: '~',
    slots: [
      { name: 'values', label: 'Data points', required: true, type: 'array' },
      { name: 'current', label: 'Current value', required: false, type: 'number' },
      { name: 'label', label: 'Label', required: false, type: 'string' },
    ],
    defaultSize: '2x1',
  },
  'text-headline': {
    name: 'text-headline',
    displayName: 'Text + Headline',
    description: 'Headline with body text',
    icon: 'T',
    slots: [
      { name: 'headline', label: 'Headline', required: true, type: 'string' },
      { name: 'body', label: 'Body text', required: false, type: 'string' },
    ],
    defaultSize: '1x1',
  },
  'text-image': {
    name: 'text-image',
    displayName: 'Text + Image',
    description: 'Text alongside an image',
    icon: 'P',
    slots: [
      { name: 'text', label: 'Text', required: true, type: 'string' },
      { name: 'imageUrl', label: 'Image URL', required: true, type: 'url' },
    ],
    defaultSize: '2x1',
  },
  image: {
    name: 'image',
    displayName: 'Image',
    description: 'Full image display',
    icon: 'I',
    slots: [
      { name: 'imageUrl', label: 'Image URL', required: true, type: 'url' },
      { name: 'alt', label: 'Alt text', required: false, type: 'string' },
    ],
    defaultSize: '2x2',
  },
  table: {
    name: 'table',
    displayName: 'Table',
    description: 'Data table with rows and columns',
    icon: '=',
    slots: [
      { name: 'rows', label: 'Rows', required: true, type: 'array' },
      { name: 'columns', label: 'Column names', required: false, type: 'array' },
    ],
    defaultSize: '2x1',
  },
  status: {
    name: 'status',
    displayName: 'Status',
    description: 'Colored dot with status label',
    icon: '*',
    slots: [
      { name: 'status', label: 'Status', required: true, type: 'string' },
      { name: 'label', label: 'Label', required: false, type: 'string' },
      { name: 'message', label: 'Message', required: false, type: 'string' },
    ],
    defaultSize: '1x1',
  },
  media: {
    name: 'media',
    displayName: 'Media Player',
    description: 'Image or video with optional title and caption',
    icon: '\u25B6',
    slots: [
      { name: 'url', label: 'Media URL', required: true, type: 'url' },
      { name: 'title', label: 'Title', required: false, type: 'string' },
      { name: 'caption', label: 'Caption', required: false, type: 'string' },
      { name: 'mediaType', label: 'Type (image/video)', required: false, type: 'string' },
    ],
    defaultSize: '2x1',
  },
};

// ── Backward compatibility ───────────────────────────────────────────────

export interface NormalizedSignal {
  template: SignalTemplate;
  mapping: Record<string, string>;
}

/**
 * Normalize a v1 format+field signal to a v2 template+mapping.
 * If template is already set, passes through. Never mutates the input.
 */
export function normalizeSignal(signal: AgentSignal): NormalizedSignal {
  if (signal.template) {
    return {
      template: signal.template,
      mapping: signal.mapping ?? {},
    };
  }

  // v1 → v2 mapping
  const field = signal.field ?? 'result';
  switch (signal.format) {
    case 'number':
      return { template: 'metric', mapping: { value: field } };
    case 'text':
      return { template: 'text-headline', mapping: { headline: signal.title, body: field } };
    case 'table':
      return { template: 'table', mapping: { rows: field } };
    case 'json':
      return { template: 'text-headline', mapping: { headline: 'JSON', body: field } };
    case 'chart':
      return { template: 'time-series', mapping: { values: field } };
    default:
      return { template: 'text-headline', mapping: { body: field } };
  }
}

// ── Value extraction ─────────────────────────────────────────────────────

/**
 * Resolve a mapping against a run's output. For each mapping key:
 * 1. Try to extract via dot-path from structured output (outputsJson)
 * 2. Try to extract via dot-path from JSON-parsed run.result
 * 3. If the mapping value is "result", use the raw run result
 * 4. Otherwise treat the mapping value as a literal string
 */
export function extractMappedValues(
  run: Run | undefined,
  mapping: Record<string, string>,
  outputsJson?: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!run) return result;

  // Pre-parse available structured data
  let structured: Record<string, unknown> | undefined;
  if (outputsJson) {
    try { structured = JSON.parse(outputsJson); } catch { /* ignore */ }
  }

  let parsedResult: Record<string, unknown> | undefined;
  if (run.result) {
    try {
      const p = JSON.parse(run.result);
      if (typeof p === 'object' && p !== null) parsedResult = p as Record<string, unknown>;
    } catch { /* not JSON */ }
  }

  for (const [slot, pathOrLiteral] of Object.entries(mapping)) {
    // Try structured output first
    if (structured) {
      const val = dotGet(structured, pathOrLiteral);
      if (val !== undefined) { result[slot] = val; continue; }
    }

    // Try parsed result
    if (parsedResult) {
      const val = dotGet(parsedResult, pathOrLiteral);
      if (val !== undefined) { result[slot] = val; continue; }
    }

    // "result" is the special key for raw output
    if (pathOrLiteral === 'result' && run.result) {
      result[slot] = run.result;
      continue;
    }

    // Treat as literal string
    result[slot] = pathOrLiteral;
  }

  return result;
}

function dotGet(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
