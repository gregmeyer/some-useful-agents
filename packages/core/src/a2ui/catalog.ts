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
    summary: 'Rows (an array of objects) shown in named columns; link columns render the value as a link. Optional sortColumns/defaultSort, filterColumns/filterPlaceholder and pageSize make it sortable, filterable and paged in the browser.',
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
      /** Columns the viewer can sort by (click the header); `defaultSort` is "col" or "col desc". */
      sortColumns: z.array(z.string().min(1).max(64)).max(12).optional(),
      defaultSort: z.string().max(80).optional(),
      /** Columns a filter box searches (case-insensitive substring). */
      filterColumns: z.array(z.string().min(1).max(64)).max(12).optional(),
      filterPlaceholder: z.string().max(80).optional(),
      /** Rows per page, with a pager when there are more. */
      pageSize: z.number().int().min(1).max(200).optional(),
    }).strict(),
  },
  {
    name: 'Disclosure',
    summary: 'A collapsible section: a label that shows or hides its child component.',
    example: { id: 'more', component: 'Disclosure', label: 'More details', child: 'more_body', open: false },
    schema: Common.extend({ label: Str, child: CS.ComponentId, open: z.boolean().optional() }).strict(),
  },
  {
    name: 'Link',
    summary: 'A link that opens in a new tab (http/https, or a dashboard path starting with /).',
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
    name: 'OptionGrid',
    summary: 'Candidates as cards (photo, rank, price, facts, stage) or a table, with a Grid/Table switch; from an array of options shaped like a notebook\'s (title, fields, price, measure, place, link, image, stage, ruledOut). `fields` (the field list) formats the facts; `actions` adds Move / Rule out buttons that send `notebook-option` actions.',
    example: { id: 'shortlist', component: 'OptionGrid', options: { path: '/notebook/options' }, fields: { path: '/notebook/fields' }, stages: { path: '/notebook/stages' }, layout: 'grid', sort: 'price' },
    schema: Common.extend({
      options: CS.DynamicValue,
      fields: CS.DynamicValue.optional(),
      stages: CS.DynamicValue.optional(),
      layout: z.enum(['grid', 'table']).optional(),
      /** A field key, or `price` / `measure`, optionally followed by ` desc`. */
      sort: z.string().max(80).optional(),
      /** Ruled-out options: hidden, or shown at the end (default). */
      ruledOut: z.enum(['show', 'hide']).optional(),
      actions: z.boolean().optional(),
      maxItems: z.number().int().min(1).max(100).optional(),
    }).strict(),
  },
  {
    name: 'Scatter',
    summary: 'Items as dots on two numeric axes, with optional shaded ranges (a budget, a mileage band) and the best one highlighted; from an array of objects.',
    example: { id: 'map', component: 'Scatter', points: { path: '/notebook/options' }, x: 'measure', y: 'price', xLabel: 'Miles', yLabel: 'Price', yFormat: 'money', xBand: { path: '/notebook/bands/measure' }, yBand: { path: '/notebook/bands/price' } },
    schema: Common.extend({
      points: CS.DynamicValue,
      /** Keys into each item (dotted for nested: `fields.year`). */
      x: z.string().min(1).max(64),
      y: z.string().min(1).max(64),
      label: z.string().max(64).optional(),
      xLabel: Str.optional(),
      yLabel: Str.optional(),
      xFormat: z.enum(['number', 'money']).optional(),
      yFormat: z.enum(['number', 'money']).optional(),
      /** {min, max} ranges to shade, and which way is better on each axis (for "best"). */
      xBand: CS.DynamicValue.optional(),
      yBand: CS.DynamicValue.optional(),
      xBetter: z.enum(['higher', 'lower']).optional(),
      yBetter: z.enum(['higher', 'lower']).optional(),
    }).strict(),
  },
  {
    name: 'SanitizedHtml',
    summary: 'Agent-written HTML, passed through sua\'s allowlist sanitizer before display (no scripts).',
    example: { id: 'card', component: 'SanitizedHtml', html: { path: '/outputs/html' } },
    schema: Common.extend({ html: Str }).strict(),
  },
] as const;

/**
 * Board-only components (docs/boards.md): the layout and tiles of a canvas
 * board. They're in the sua catalog so the browser draws them, but agent views
 * can't use them (validateViewComponents refuses them unless it's validating a
 * board) and they're left out of the component docs agents see for views.
 */
const BOARD_COMPONENTS = [
  {
    name: 'Grid',
    summary: 'Tiles in responsive columns (each at least minWidth px wide, default 280); wrap a child in Cell to span columns or rows.',
    example: { id: 'today_grid', component: 'Grid', children: ['cell_weather', 'cell_news'], minWidth: 280 },
    schema: Common.extend({ children: CS.ChildList, minWidth: z.number().int().min(120).max(800).optional() }).strict(),
  },
  {
    name: 'Cell',
    summary: 'A Grid child that spans several columns (span, 1–4) and/or rows (rows, 1–4).',
    example: { id: 'cell_weather', component: 'Cell', child: 'tile_weather', span: 2 },
    schema: Common.extend({ child: CS.ComponentId, span: z.number().int().min(1).max(4).optional(), rows: z.number().int().min(1).max(4).optional() }).strict(),
  },
  {
    name: 'Section',
    summary: 'A titled group of the board.',
    example: { id: 'today', component: 'Section', title: 'Today', child: 'today_grid' },
    schema: Common.extend({ title: Str, child: CS.ComponentId }).strict(),
  },
  {
    name: 'AgentTile',
    summary: "An agent's tile: its latest result drawn with its own view, with Run and the tile's controls.",
    example: { id: 'tile_weather', component: 'AgentTile', agentId: 'weather-forecast' },
    schema: Common.extend({
      agentId: z.string().min(1).max(128),
      palette: z.enum(['default', 'dark', 'light', 'accent-teal', 'accent-red', 'accent-green']).optional(),
    }).strict(),
  },
  {
    name: 'SystemTile',
    summary: 'One of the health tiles (runs today, failure rate, average duration, agents, scheduler).',
    example: { id: 'tile_runs', component: 'SystemTile', tileId: '_system-runs-today' },
    schema: Common.extend({
      tileId: z.string().regex(/^_[a-z0-9_-]+$/i),
      palette: z.enum(['default', 'dark', 'light', 'accent-teal', 'accent-red', 'accent-green']).optional(),
    }).strict(),
  },
] as const;

/** Components only a board may use. */
export const BOARD_COMPONENT_NAMES: readonly string[] = BOARD_COMPONENTS.map((c) => c.name);

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
    const components = [...basicComponentApis(), ...[...SUA_COMPONENTS, ...BOARD_COMPONENTS].map(({ name, schema }) => ({ name, schema }))];
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

/** The board-only components with a summary and an example, for board prompts (board-place, the board builder). */
export function boardComponentDocs(): SuaComponentDoc[] {
  return BOARD_COMPONENTS.map(({ name, summary, example }) => ({ name, summary, example: { ...example } }));
}
