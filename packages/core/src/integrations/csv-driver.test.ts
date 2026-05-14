import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCsv,
  inferCsvSnapshot,
  readCsvRows,
  countCsvRows,
} from './csv-driver.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-csv-driver-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeCsv(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf-8');
  return path;
}

describe('parseCsv', () => {
  it('handles a basic comma-separated file', () => {
    expect(parseCsv('a,b,c\n1,2,3\n4,5,6\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('handles quoted fields with embedded commas + escaped quotes', () => {
    const text = 'name,note\n"Smith, John","said ""hi"""\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Smith, John', 'said "hi"'],
    ]);
  });

  it('handles embedded newlines inside quotes', () => {
    const text = 'a,b\n1,"line1\nline2"\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['1', 'line1\nline2'],
    ]);
  });

  it('handles CRLF line endings + trailing newline', () => {
    const text = 'a,b\r\n1,2\r\n3,4\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('strips a UTF-8 BOM', () => {
    const text = '﻿a,b\n1,2\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('inferCsvSnapshot', () => {
  it('infers number / boolean / date / timestamp / string per column', () => {
    const path = writeCsv('mixed.csv', [
      'id,active,signup_date,last_seen,email',
      '1,true,2026-01-01,2026-05-12T08:00:00Z,a@x.com',
      '2,false,2026-02-15,2026-05-12T09:30:00Z,b@x.com',
      '3,1,2026-03-30,2026-05-12T10:00:00Z,c@x.com',
    ].join('\n'));
    const snap = inferCsvSnapshot(path, { cwd: dir });
    expect(snap.columns).toEqual([
      { name: 'id', type: 'number' },
      { name: 'active', type: 'boolean' },
      { name: 'signup_date', type: 'string', format: 'date' },
      { name: 'last_seen', type: 'string', format: 'timestamp' },
      { name: 'email', type: 'string' },
    ]);
    expect(snap.rowCount).toBe(3);
    expect(snap.sampledRowCount).toBe(3);
  });

  it('falls back to string when a column is mixed', () => {
    const path = writeCsv('mixed-types.csv', 'val\n1\nfoo\n2\n');
    expect(inferCsvSnapshot(path, { cwd: dir }).columns).toEqual([
      { name: 'val', type: 'string' },
    ]);
  });

  it('handles header-less files via synthesised col_N names', () => {
    const path = writeCsv('headerless.csv', '1,a\n2,b\n');
    const snap = inferCsvSnapshot(path, { cwd: dir, hasHeader: false });
    expect(snap.columns.map((c) => c.name)).toEqual(['col_0', 'col_1']);
  });

  it('refuses to read files past the byte cap', () => {
    const path = writeCsv('huge.csv', 'a\n' + '1\n'.repeat(50));
    expect(() => inferCsvSnapshot(path, { cwd: dir, maxBytes: 5 })).toThrow(/cap/);
  });
});

describe('readCsvRows', () => {
  it('returns coerced rows respecting limit', () => {
    const path = writeCsv('customers.csv', [
      'id,active,email',
      '1,true,a@x.com',
      '2,false,b@x.com',
      '3,true,c@x.com',
    ].join('\n'));
    const cols = inferCsvSnapshot(path, { cwd: dir }).columns;
    const rows = readCsvRows(path, cols, { cwd: dir, limit: 2 });
    expect(rows).toEqual([
      { id: 1, active: true, email: 'a@x.com' },
      { id: 2, active: false, email: 'b@x.com' },
    ]);
  });

  it('filters by where clause (loose equality across coerced types)', () => {
    const path = writeCsv('customers.csv', [
      'id,active,email',
      '1,true,a@x.com',
      '2,false,b@x.com',
      '3,true,c@x.com',
    ].join('\n'));
    const cols = inferCsvSnapshot(path, { cwd: dir }).columns;
    const rows = readCsvRows(path, cols, { cwd: dir, where: { active: true } });
    expect(rows.map((r) => r.id)).toEqual([1, 3]);
  });

  it('returns empty cells as null', () => {
    const path = writeCsv('sparse.csv', 'id,note\n1,\n2,foo\n');
    const cols = inferCsvSnapshot(path, { cwd: dir }).columns;
    const rows = readCsvRows(path, cols, { cwd: dir });
    expect(rows).toEqual([
      { id: 1, note: null },
      { id: 2, note: 'foo' },
    ]);
  });
});

describe('countCsvRows', () => {
  it('counts matching rows without materialising the list', () => {
    const path = writeCsv('big.csv', ['n', '1', '2', '3', '4', '5', '6'].join('\n'));
    const cols = inferCsvSnapshot(path, { cwd: dir }).columns;
    expect(countCsvRows(path, cols, { cwd: dir })).toBe(6);
    expect(countCsvRows(path, cols, { cwd: dir, where: { n: 3 } })).toBe(1);
  });
});
