import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAppleSubcommand, ensureAppleRunner } from './apple-runner.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Write an executable fake runner so tests exercise the spawn/parse path. */
function fakeBinary(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'apple-fake-'));
  dirs.push(dir);
  const path = join(dir, 'fake');
  writeFileSync(path, body, 'utf-8');
  chmodSync(path, 0o755);
  return path;
}

describe('runAppleSubcommand', () => {
  it('parses an ok JSON line', async () => {
    const bin = fakeBinary(`#!/usr/bin/env bash
cat >/dev/null
echo '{"status":"ok","data":{"id":"r1","title":"Buy milk"},"error_message":null}'
`);
    const res = await runAppleSubcommand(bin, 'reminder-create', { title: 'Buy milk' });
    expect(res.status).toBe('ok');
    expect(res.data).toEqual({ id: 'r1', title: 'Buy milk' });
    expect(res.errorMessage).toBeNull();
  });

  it('surfaces a denied status + message (nonzero exit)', async () => {
    const bin = fakeBinary(`#!/usr/bin/env bash
cat >/dev/null
echo '{"status":"denied","data":null,"error_message":"Reminders access denied"}'
exit 1
`);
    const res = await runAppleSubcommand(bin, 'reminder-read', {});
    expect(res.status).toBe('denied');
    expect(res.errorMessage).toContain('denied');
  });

  it('takes the last JSON line past stray framework logging', async () => {
    const bin = fakeBinary(`#!/usr/bin/env bash
cat >/dev/null
echo 'some framework warning on stdout'
echo '{"status":"ok","data":{"count":0,"reminders":[]},"error_message":null}'
`);
    const res = await runAppleSubcommand(bin, 'reminder-read', {});
    expect(res.status).toBe('ok');
    expect((res.data as { count: number }).count).toBe(0);
  });

  it('throws on non-JSON output', async () => {
    const bin = fakeBinary(`#!/usr/bin/env bash
cat >/dev/null
echo 'totally not json'
`);
    await expect(runAppleSubcommand(bin, 'lists', {})).rejects.toThrow(/non-JSON/);
  });

  it('throws when the binary produces no output', async () => {
    const bin = fakeBinary(`#!/usr/bin/env bash
cat >/dev/null
`);
    await expect(runAppleSubcommand(bin, 'lists', {})).rejects.toThrow(/no output/);
  });

  it('pipes the JSON payload to the binary on stdin', async () => {
    const bin = fakeBinary(`#!/usr/bin/env bash
payload=$(cat)
printf '{"status":"ok","data":{"received":%s},"error_message":null}\\n' "$payload"
`);
    const res = await runAppleSubcommand(bin, 'reminder-create', { title: 'X', list: 'Home' });
    expect((res.data as { received: unknown }).received).toEqual({ title: 'X', list: 'Home' });
  });

  it('passes --dry-run before the subcommand when requested', async () => {
    // Fake echoes its argv so we can assert the flag ordering.
    const bin = fakeBinary(`#!/usr/bin/env bash
cat >/dev/null
echo "{\\"status\\":\\"ok\\",\\"data\\":{\\"argv\\":\\"$*\\"},\\"error_message\\":null}"
`);
    const res = await runAppleSubcommand(bin, 'note-create', { title: 'n' }, { dryRun: true });
    expect((res.data as { argv: string }).argv).toBe('--dry-run note-create');
  });
});

describe('ensureAppleRunner', () => {
  const orig = Object.getOwnPropertyDescriptor(process, 'platform');
  afterEach(() => {
    if (orig) Object.defineProperty(process, 'platform', orig);
  });

  it('returns unsupported off macOS (no compile attempted)', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const handle = ensureAppleRunner();
    expect(handle.status).toBe('unsupported');
    expect(handle.message).toMatch(/macOS-only/);
  });
});
