/**
 * CSV connector driver.
 *
 * Reads a CSV file, samples up to N rows, infers per-column types, and
 * returns a snapshot the dashboard stores on the integration row. The
 * snapshot drives both:
 *   - generated tool schemas (typed `rows[]` outputs the planner can
 *     reason about + the template resolver can validate at save time)
 *   - the read/count execute paths (the column-type table tells us how
 *     to coerce row values into JSON).
 *
 * RFC 4180 covered by a small hand-rolled parser. Quoted fields,
 * doubled quotes, embedded commas + newlines work. No streaming yet —
 * we read the whole file. CSV connectors at this scale (config-tier
 * tables, not warehouses) fit in memory; v2 can stream.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export type CsvColumnType = 'number' | 'boolean' | 'string';

export interface CsvColumnSpec {
  name: string;
  type: CsvColumnType;
  /** Format hint for `string` columns: 'date' (YYYY-MM-DD) or 'timestamp' (ISO 8601). */
  format?: 'date' | 'timestamp';
}

export interface CsvSnapshot {
  /** Inferred columns in source order. */
  columns: CsvColumnSpec[];
  /** Number of rows sampled at introspection time (≤ sampleSize, ≤ rowCount). */
  sampledRowCount: number;
  /** Total rows in the file at introspection time (excluding header if present). */
  rowCount: number;
  /** ISO timestamp of the introspection. */
  introspectedAt: string;
}

export interface ReadCsvSnapshotOptions {
  /** Whether the first physical row is a header. Defaults to true. */
  hasHeader?: boolean;
  /** Field separator. Defaults to ','. */
  delimiter?: string;
  /** Number of rows to sample for type inference. Defaults to 200. */
  sampleSize?: number;
  /** Process cwd to resolve relative paths against. Defaults to process.cwd(). */
  cwd?: string;
  /** Hard cap on file bytes read for the snapshot. Defaults to 16 MiB. */
  maxBytes?: number;
}

export interface ReadCsvOptions extends ReadCsvSnapshotOptions {
  /** Column → expected value (exact equality). Multiple keys are AND-ed. */
  where?: Record<string, unknown>;
  /** Cap on returned rows. Defaults to 1000. */
  limit?: number;
}

export interface CsvRow {
  [column: string]: string | number | boolean | null;
}

const DEFAULT_SAMPLE_SIZE = 200;
const DEFAULT_LIMIT = 1000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Read a CSV file end-to-end and return a typed snapshot. Used both
 * at integration-add time (to seed `integration.config.schema`) and
 * by the read/count tools at run time.
 */
export function inferCsvSnapshot(
  rawPath: string,
  opts: ReadCsvSnapshotOptions = {},
): CsvSnapshot {
  const { records, headerNames } = readCsvFile(rawPath, opts);
  const rowCount = records.length;
  const sample = records.slice(0, opts.sampleSize ?? DEFAULT_SAMPLE_SIZE);
  const columns: CsvColumnSpec[] = headerNames.map((name, i) => {
    const colValues = sample.map((r) => r[i] ?? '').filter((v) => v.length > 0);
    return inferColumnType(name, colValues);
  });
  return {
    columns,
    sampledRowCount: sample.length,
    rowCount,
    introspectedAt: new Date().toISOString(),
  };
}

/**
 * Read rows from a CSV file, optionally filtered by `where` and capped
 * by `limit`. Values are coerced according to `columns` so JSON
 * consumers see `number`/`boolean`/`null` instead of always-strings.
 */
export function readCsvRows(
  rawPath: string,
  columns: CsvColumnSpec[],
  opts: ReadCsvOptions = {},
): CsvRow[] {
  const { records, headerNames } = readCsvFile(rawPath, opts);
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const where = normalizeWhere(opts.where);
  const out: CsvRow[] = [];
  for (const record of records) {
    const row = recordToRow(headerNames, columns, record);
    if (matchesWhere(row, where)) {
      out.push(row);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Count matching rows without materialising the full result set.
 * Streaming would help here for huge files; keeping it simple for v1.
 */
export function countCsvRows(
  rawPath: string,
  columns: CsvColumnSpec[],
  opts: Omit<ReadCsvOptions, 'limit'> = {},
): number {
  const { records, headerNames } = readCsvFile(rawPath, opts);
  const where = normalizeWhere(opts.where);
  let count = 0;
  for (const record of records) {
    const row = recordToRow(headerNames, columns, record);
    if (matchesWhere(row, where)) count++;
  }
  return count;
}

// ── File reader ─────────────────────────────────────────────────────────

/**
 * Resolves the path against cwd, enforces the byte cap, and parses.
 * Returns raw string cells per record + the header row (synthesised
 * if hasHeader=false).
 *
 * Note: no path-traversal guard here. Callers configure CSV paths via
 * the Settings → Integrations UI (user-trusted input) — not from agent
 * YAML or upstream node output — so cwd-escape protection lives at
 * the integration-add boundary instead of this driver. Tools that
 * execute against the integration's stored path are read-only and
 * touch only the file the user pointed at.
 */
function readCsvFile(
  rawPath: string,
  opts: ReadCsvSnapshotOptions,
): { records: string[][]; headerNames: string[] } {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const filePath = resolve(cwd, rawPath);
  if (!existsSync(filePath)) {
    throw new Error(`CSV file "${filePath}" does not exist.`);
  }
  const stat = statSync(filePath);
  const cap = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (stat.size > cap) {
    throw new Error(`CSV file "${filePath}" is ${stat.size} bytes (cap is ${cap}). Move large files to a Postgres connector instead.`);
  }
  const raw = readFileSync(filePath, 'utf-8');
  const all = parseCsv(raw, opts.delimiter ?? ',');
  if (all.length === 0) {
    return { records: [], headerNames: [] };
  }
  const hasHeader = opts.hasHeader !== false;
  if (hasHeader) {
    const headerNames = dedupeHeaders(all[0]);
    return { records: all.slice(1), headerNames };
  }
  // No header: synthesise col_0, col_1, …
  const cols = all[0].length;
  const headerNames = Array.from({ length: cols }, (_, i) => `col_${i}`);
  return { records: all, headerNames };
}

function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h) => {
    const base = h.trim() || 'col';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}_${n}`;
  });
}

// ── RFC 4180-ish parser ─────────────────────────────────────────────────

/**
 * Parses CSV text into a list of records (each a list of cells).
 *
 * Handles:
 *   - Quoted fields with embedded delimiter (`"foo,bar"`)
 *   - Doubled quote escape (`""` → `"`)
 *   - Embedded newlines inside quotes
 *   - CRLF, LF, and CR line endings
 *
 * Does NOT handle:
 *   - Custom escape characters (only `""`)
 *   - BOM markers other than UTF-8 (we strip the UTF-8 BOM)
 *   - Variable-length records (each record gets whatever cells it has;
 *     coercion later pads/truncates against the header)
 */
export function parseCsv(input: string, delimiter: string = ','): string[][] {
  // Strip UTF-8 BOM if present.
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { // escaped quote
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(cell);
      cell = '';
      // Skip the LF in a CRLF pair.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      records.push(row);
      row = [];
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // Flush trailing cell + record (no terminating newline).
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    records.push(row);
  }
  // Drop a trailing empty record from a final newline.
  if (records.length > 0) {
    const last = records[records.length - 1];
    if (last.length === 1 && last[0] === '') records.pop();
  }
  return records;
}

// ── Type inference ──────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const INT_RE = /^-?\d+$/;
const FLOAT_RE = /^-?\d+\.\d+$/;
const BOOL_TRUE = new Set(['true', 'yes']);
const BOOL_FALSE = new Set(['false', 'no']);

function inferColumnType(name: string, values: string[]): CsvColumnSpec {
  if (values.length === 0) return { name, type: 'string' };
  let allInt = true;
  let allFloat = true;
  let allBool = true;
  let allDate = true;
  let allTimestamp = true;
  for (const raw of values) {
    const v = raw.trim();
    if (!INT_RE.test(v)) allInt = false;
    if (!FLOAT_RE.test(v) && !INT_RE.test(v)) allFloat = false;
    const lower = v.toLowerCase();
    if (!BOOL_TRUE.has(lower) && !BOOL_FALSE.has(lower) && lower !== '0' && lower !== '1') allBool = false;
    if (!DATE_RE.test(v)) allDate = false;
    if (!TIMESTAMP_RE.test(v)) allTimestamp = false;
  }
  if (allInt) return { name, type: 'number' };
  if (allFloat) return { name, type: 'number' };
  if (allBool) return { name, type: 'boolean' };
  if (allDate) return { name, type: 'string', format: 'date' };
  if (allTimestamp) return { name, type: 'string', format: 'timestamp' };
  return { name, type: 'string' };
}

// ── Row coercion + filtering ───────────────────────────────────────────

function recordToRow(headers: string[], columns: CsvColumnSpec[], record: string[]): CsvRow {
  const row: CsvRow = {};
  for (let i = 0; i < headers.length; i++) {
    const col = columns[i] ?? { name: headers[i], type: 'string' as const };
    const raw = record[i] ?? '';
    row[headers[i]] = coerce(raw, col);
  }
  return row;
}

function coerce(raw: string, col: CsvColumnSpec): string | number | boolean | null {
  const v = raw.trim();
  if (v === '') return null;
  if (col.type === 'number') {
    const n = Number(v);
    return Number.isNaN(n) ? raw : n;
  }
  if (col.type === 'boolean') {
    const lower = v.toLowerCase();
    if (BOOL_TRUE.has(lower) || lower === '1') return true;
    if (BOOL_FALSE.has(lower) || lower === '0') return false;
    return raw;
  }
  return raw;
}

function normalizeWhere(where: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!where || typeof where !== 'object') return {};
  return where;
}

function matchesWhere(row: CsvRow, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    const rv = row[k];
    // Loose equality so `where: { active: true }` matches a coerced
    // `true` boolean cell, and `where: { id: '42' }` matches a coerced
    // `42` number cell. Tighten to strict eq if this proves leaky.
    // eslint-disable-next-line eqeqeq
    if (rv != v) return false;
  }
  return true;
}
