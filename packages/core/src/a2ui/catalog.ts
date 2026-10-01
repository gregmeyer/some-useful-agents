/**
 * The sua A2UI catalog (protocol v0.9): the A2UI basic catalog plus the
 * components a dashboard widget needs that the basic one lacks (metrics,
 * tables, key/value lists, badges, links, code, sanitized HTML).
 *
 * The component APIs are the SAME objects the A2UI renderer uses
 * (`@a2ui/web_core`, pinned), so validating a view here and drawing it in the
 * browser can't disagree. The browser-side elements for the sua components
 * live in the dashboard (`assets/a2ui-sua.js`); their props must match these
 * schemas. See docs/adr/0047-a2ui-views.md.
 */
import { z } from 'zod/v3';
import { Catalog, CommonSchemas } from '@a2ui/web_core/v0_9';
import * as basic from '@a2ui/web_core/v0_9/basic_catalog';

export const SUA_CATALOG_ID = 'https://some-useful-agents.dev/a2ui/catalogs/sua/v1.json';
export const A2UI_PROTOCOL_VERSION = 'v0.9';

// Untyped on purpose: zod v3's types for A2UI's recursive dynamic values
// overflow TypeScript ("excessively deep"). The schemas are checked at
// runtime by the A2UI processor, which is the point.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CS = CommonSchemas as any;
/** Props every component may carry (accessibility, weight), minus the envelope `id`. */
const Common = CS.ComponentCommon.omit({ id: true });
const Str = CS.DynamicString;
const Tone = Str.describe('neutral | ok | warn | err');

export interface SuaComponentDoc {
  name: string;
  summary: string;
  example: Record<string, unknown>;
}

/** sua's own components: name, zod (v3) schema, and a one-line doc for prompts. */
const SUA_COMPONENTS = [
  {
    name: 'Metric',
    summary: 'A big number with a label; optional unit, delta line and tone.',
    example: { id: 'temp', component: 'Metric', label: 'Now', value: { path: '/outputs/temp' }, unit: '°C', tone: 'ok' },
    schema: Common.extend({
      label: Str,
      value: Str,
      unit: Str.optional(),
      delta: Str.optional(),
      tone: Tone.optional(),
    }).strict(),
  },
  {
    name: 'Badge',
    summary: 'A short status pill.',
    example: { id: 'state', component: 'Badge', text: { path: '/outputs/status' }, tone: 'warn' },
    schema: Common.extend({ text: Str, tone: Tone.optional() }).strict(),
  },
  {
    name: 'KeyValue',
    summary: 'Label/value rows from an array of {label, value} objects.',
    example: { id: 'facts', component: 'KeyValue', items: { path: '/outputs/facts' } },
    schema: Common.extend({ items: CS.DynamicValue }).strict(),
  },
  {
    name: 'Table',
    summary: 'Rows (an array of objects) shown in named columns; link columns render the value as a link.',
    example: {
      id: 'jobs', component: 'Table', rows: { path: '/outputs/jobs' },
      columns: [{ key: 'title', label: 'Role' }, { key: 'url', label: 'Link', format: 'link' }],
    },
    schema: Common.extend({
      rows: CS.DynamicValue,
      columns: z.array(z.object({
        key: z.string().min(1).max(64),
        label: z.string().min(1).max(80),
        format: z.enum(['text', 'link']).optional(),
      }).strict()).min(1).max(12),
      maxRows: z.number().int().min(1).max(200).optional(),
    }).strict(),
  },
  {
    name: 'Link',
    summary: 'A link that opens in a new tab (http/https only).',
    example: { id: 'src', component: 'Link', text: 'Source', url: { path: '/outputs/url' } },
    schema: Common.extend({ text: Str, url: Str }).strict(),
  },
  {
    name: 'Code',
    summary: 'Preformatted text in a monospace block.',
    example: { id: 'log', component: 'Code', text: { path: '/result' } },
    schema: Common.extend({ text: Str, language: z.string().max(32).optional() }).strict(),
  },
  {
    name: 'Sparkline',
    summary: 'A small line chart of a series of numbers, with an optional label and current value.',
    example: { id: 'trend', component: 'Sparkline', values: { path: '/outputs/history' }, label: 'Stars this week', current: { path: '/outputs/stars' } },
    schema: Common.extend({ values: CS.DynamicValue, label: Str.optional(), current: Str.optional() }).strict(),
  },
  {
    name: 'Funnel',
    summary: 'Stages as decreasing bars, from an array of {label, value}.',
    example: { id: 'signup', component: 'Funnel', stages: { path: '/outputs/stages' } },
    schema: Common.extend({ stages: CS.DynamicValue }).strict(),
  },
  {
    name: 'SanitizedHtml',
    summary: 'Agent-written HTML, passed through sua\'s allowlist sanitizer before display (no scripts).',
    example: { id: 'card', component: 'SanitizedHtml', html: { path: '/outputs/html' } },
    schema: Common.extend({ html: Str }).strict(),
  },
] as const;

/** Basic catalog component APIs (Text, Image, Row, Column, List, Card, Button, …). */
function basicComponentApis(): Array<{ name: string; schema: unknown }> {
  return Object.entries(basic)
    .filter(([key, v]) => key.endsWith('Api') && v && typeof v === 'object'
      && 'schema' in v && 'name' in v && !('returnType' in v))
    .map(([, v]) => v as { name: string; schema: unknown });
}

let catalog: Catalog<never> | undefined;

/** The sua catalog, built once. */
export function suaCatalog(): Catalog<never> {
  if (!catalog) {
    const components = [...basicComponentApis(), ...SUA_COMPONENTS.map(({ name, schema }) => ({ name, schema }))];
    catalog = new Catalog(SUA_CATALOG_ID, '0.9', components as never[], basic.BASIC_FUNCTIONS as never[]) as Catalog<never>;
  }
  return catalog;
}

/** Component names in the sua catalog, basic first. */
export function suaCatalogComponentNames(): string[] {
  return [...suaCatalog().components.keys()];
}

/** The sua-only components with a one-line summary and an example, for docs and prompts. */
export function suaComponentDocs(): SuaComponentDoc[] {
  return SUA_COMPONENTS.map(({ name, summary, example }) => ({ name, summary, example: { ...example } }));
}
