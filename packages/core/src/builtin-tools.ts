import { execSync, type ExecSyncOptions } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lookup } from 'node:dns/promises';
import type {
  ToolDefinition,
  ToolOutput,
  BuiltinToolEntry,
  BuiltinToolContext,
} from './tool-types.js';

/**
 * SSRF guard: resolve the hostname to an IP and reject private, loopback,
 * link-local, and cloud-metadata addresses before making an outbound request.
 */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Resolve to IP (catches DNS rebind to private ranges)
  let ip: string;
  try {
    const result = await lookup(hostname);
    ip = result.address;
  } catch {
    throw new Error(`DNS lookup failed for ${hostname}`);
  }

  if (isPrivateIp(ip)) {
    throw new Error(
      `Blocked request to private/reserved IP ${ip} (resolved from ${hostname}). ` +
      `SSRF protection: only public addresses are allowed.`,
    );
  }
}

function isPrivateIp(ip: string): boolean {
  // IPv4
  if (ip.startsWith('127.')) return true;                // loopback
  if (ip.startsWith('10.')) return true;                 // RFC 1918
  if (ip.startsWith('192.168.')) return true;            // RFC 1918
  if (ip === '0.0.0.0') return true;
  if (ip.startsWith('169.254.')) return true;            // link-local / cloud metadata
  // 172.16.0.0/12
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6
  if (ip === '::1') return true;                         // loopback
  if (ip === '::') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // unique local
  if (ip.startsWith('fe80')) return true;                // link-local

  return false;
}

/**
 * Built-in tool registry. Each entry provides a ToolDefinition (schema)
 * plus a Node-native execute function the executor calls directly —
 * no child process spawn needed for the hot path.
 *
 * Built-ins are always trusted (source: 'builtin'); the community-shell
 * gate doesn't apply.
 */

function def(
  id: string,
  name: string,
  description: string,
  inputs: ToolDefinition['inputs'],
  outputs: ToolDefinition['outputs'],
  execute: BuiltinToolEntry['execute'],
): BuiltinToolEntry {
  return {
    definition: {
      id,
      name,
      description,
      source: 'builtin',
      inputs,
      outputs,
      implementation: { type: 'builtin', builtinName: id },
    },
    execute,
  };
}

const BUILTINS: BuiltinToolEntry[] = [
  def(
    'shell-exec',
    'Shell exec',
    'Run an arbitrary shell command. Backcompat tool for v0.15 type:shell nodes.',
    {
      command: { type: 'string', description: 'Shell command to execute.' },
    },
    {
      stdout: { type: 'string', description: 'Full stdout.' },
      stderr: { type: 'string', description: 'Full stderr.' },
      exit_code: { type: 'number', description: 'Process exit code.' },
      result: { type: 'string', description: 'Alias for stdout (v0.15 compat).' },
    },
    async (inputs, ctx) => {
      const command = String(inputs.command ?? '');
      const opts: ExecSyncOptions = {
        cwd: ctx.workingDirectory,
        env: { ...process.env, ...ctx.env },
        timeout: (ctx.timeout ?? 300) * 1000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      };
      try {
        const stdout = execSync(command, opts) as unknown as string;
        return { stdout, stderr: '', exit_code: 0, result: stdout };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; status?: number };
        const stdout = String(e.stdout ?? '');
        const stderr = String(e.stderr ?? '');
        return { stdout, stderr, exit_code: e.status ?? 1, result: stdout };
      }
    },
  ),

  def(
    'claude-code',
    'Claude Code',
    'Run a Claude Code prompt. Backcompat tool for v0.15 type:claude-code nodes.',
    {
      prompt: { type: 'string', description: 'Prompt text.' },
      model: { type: 'string', description: 'Model override.' },
      maxTurns: { type: 'number', description: 'Max conversation turns.', default: 10 },
      allowedTools: { type: 'json', description: 'Allowed tool names (JSON array).' },
    },
    {
      text: { type: 'string', description: 'Assistant final text.' },
      result: { type: 'string', description: 'Alias for text (v0.15 compat).' },
    },
    async (inputs, ctx) => {
      const prompt = String(inputs.prompt ?? '');
      const args = ['--print', prompt];
      if (inputs.model) args.push('--model', String(inputs.model));
      if (inputs.maxTurns) args.push('--max-turns', String(inputs.maxTurns));
      const allowedTools = inputs.allowedTools;
      if (Array.isArray(allowedTools)) {
        for (const t of allowedTools) args.push('--allowedTools', String(t));
      }
      const opts: ExecSyncOptions = {
        cwd: ctx.workingDirectory,
        env: { ...process.env, ...ctx.env },
        timeout: (ctx.timeout ?? 600) * 1000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      };
      try {
        const stdout = execSync(`claude ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, opts) as unknown as string;
        return { text: stdout, result: stdout };
      } catch (err: unknown) {
        const e = err as { stdout?: string; status?: number };
        const text = String(e.stdout ?? '');
        return { text, result: text, exit_code: e.status ?? 1 };
      }
    },
  ),

  def(
    'http-get',
    'HTTP GET',
    'Issue an HTTP GET and return the response. JSON bodies are auto-parsed.',
    {
      url: { type: 'string', description: 'Absolute URL to fetch.', required: true },
      timeout: { type: 'number', description: 'Timeout in seconds.', default: 30 },
    },
    {
      status: { type: 'number', description: 'HTTP status code.' },
      body: { type: 'json', description: 'Response body (JSON-decoded if applicable, else string).' },
      headers: { type: 'object', description: 'Response headers.' },
      duration_ms: { type: 'number', description: 'Request duration in milliseconds.' },
    },
    async (inputs) => {
      const url = String(inputs.url ?? '');
      await assertSafeUrl(url);
      const timeout = Number(inputs.timeout ?? 30) * 1000;
      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, { signal: controller.signal });
        const text = await res.text();
        let body: unknown;
        try { body = JSON.parse(text); } catch { body = text; }
        return {
          status: res.status,
          body,
          headers: Object.fromEntries(res.headers.entries()),
          duration_ms: Date.now() - start,
          result: typeof body === 'string' ? body : JSON.stringify(body),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  ),

  def(
    'http-post',
    'HTTP POST',
    'Issue an HTTP POST with a JSON body.',
    {
      url: { type: 'string', description: 'Absolute URL.', required: true },
      body: { type: 'json', description: 'Request body (JSON-encoded).' },
      timeout: { type: 'number', description: 'Timeout in seconds.', default: 30 },
    },
    {
      status: { type: 'number', description: 'HTTP status code.' },
      body: { type: 'json', description: 'Response body.' },
      headers: { type: 'object', description: 'Response headers.' },
      duration_ms: { type: 'number', description: 'Request duration in milliseconds.' },
    },
    async (inputs) => {
      const url = String(inputs.url ?? '');
      await assertSafeUrl(url);
      const timeout = Number(inputs.timeout ?? 30) * 1000;
      const reqBody = inputs.body !== undefined ? JSON.stringify(inputs.body) : undefined;
      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: reqBody ? { 'Content-Type': 'application/json' } : {},
          body: reqBody,
          signal: controller.signal,
        });
        const text = await res.text();
        let body: unknown;
        try { body = JSON.parse(text); } catch { body = text; }
        return {
          status: res.status,
          body,
          headers: Object.fromEntries(res.headers.entries()),
          duration_ms: Date.now() - start,
          result: typeof body === 'string' ? body : JSON.stringify(body),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  ),

  def(
    'file-read',
    'File read',
    'Read a file from the project directory.',
    {
      path: { type: 'string', description: 'Relative path within the project.', required: true },
    },
    {
      content: { type: 'string', description: 'File content as UTF-8.' },
      bytes: { type: 'number', description: 'File size in bytes.' },
      result: { type: 'string', description: 'Alias for content.' },
    },
    async (inputs, ctx) => {
      const cwd = ctx.workingDirectory ?? process.cwd();
      const filePath = resolve(cwd, String(inputs.path));
      if (!filePath.startsWith(resolve(cwd) + '/') && filePath !== resolve(cwd)) {
        throw new Error(`Path "${String(inputs.path)}" escapes the working directory.`);
      }
      const content = readFileSync(filePath, 'utf-8');
      return { content, bytes: Buffer.byteLength(content), result: content };
    },
  ),

  def(
    'file-write',
    'File write',
    'Write content to a file in the project directory.',
    {
      path: { type: 'string', description: 'Relative path within the project.', required: true },
      content: { type: 'string', description: 'Content to write.', required: true },
    },
    {
      bytes: { type: 'number', description: 'Bytes written.' },
      path: { type: 'string', description: 'Resolved file path.' },
      result: { type: 'string', description: 'Resolved file path.' },
    },
    async (inputs, ctx) => {
      const cwd = ctx.workingDirectory ?? process.cwd();
      const filePath = resolve(cwd, String(inputs.path));
      if (!filePath.startsWith(resolve(cwd) + '/') && filePath !== resolve(cwd)) {
        throw new Error(`Path "${String(inputs.path)}" escapes the working directory.`);
      }
      const content = String(inputs.content);
      writeFileSync(filePath, content, 'utf-8');
      return { bytes: Buffer.byteLength(content), path: filePath, result: filePath };
    },
  ),

  def(
    'json-parse',
    'JSON parse',
    'Parse a JSON string into a structured value.',
    {
      text: { type: 'string', description: 'JSON string to parse.', required: true },
    },
    {
      value: { type: 'json', description: 'Parsed value.' },
      result: { type: 'string', description: 'Re-serialized JSON.' },
    },
    async (inputs) => {
      const text = String(inputs.text ?? '');
      const value = JSON.parse(text);
      return { value, result: JSON.stringify(value) };
    },
  ),

  def(
    'json-path',
    'JSON path',
    'Extract a value from a JSON object using a dot-separated path.',
    {
      data: { type: 'json', description: 'Input object/array.', required: true },
      path: { type: 'string', description: 'Dot-separated path (e.g. "items.0.title").', required: true },
    },
    {
      value: { type: 'json', description: 'Extracted value.' },
      result: { type: 'string', description: 'Extracted value as string.' },
    },
    async (inputs) => {
      const data = inputs.data;
      const path = String(inputs.path ?? '');
      let current: unknown = data;
      for (const segment of path.split('.')) {
        if (current === null || current === undefined) break;
        if (typeof current === 'object') {
          current = (current as Record<string, unknown>)[segment];
        } else {
          current = undefined;
        }
      }
      const str = current === undefined ? '' : typeof current === 'string' ? current : JSON.stringify(current);
      return { value: current, result: str };
    },
  ),

  def(
    'template',
    'Template',
    'Literal text with {{inputs.X}} interpolation. No side effects.',
    {
      text: { type: 'string', description: 'Template text.', required: true },
    },
    {
      result: { type: 'string', description: 'Interpolated text.' },
    },
    async (inputs) => {
      return { result: String(inputs.text ?? '') };
    },
  ),

  def(
    'csv-to-chart-json',
    'CSV → chart JSON',
    'Parse CSV into the shape modern-graphics-generate-graphic expects. "simple" shape → {labels,values}; "series" shape → {labels,series:[{name,values}]}; "cohort" shape → {cohorts:[{date,size,values}]}. First row is the header. Quoted fields and commas inside quotes are supported.',
    {
      csv: {
        type: 'string',
        description: 'Raw CSV text. Either csv or path is required.',
      },
      path: {
        type: 'string',
        description: 'Path to a CSV file (read relative to the run cwd). Used if csv is empty.',
      },
      shape: {
        type: 'string',
        description: '"simple" | "series" | "cohort". Default "simple".',
        default: 'simple',
      },
    },
    {
      data_json: { type: 'string', description: 'JSON string ready for generate_graphic.' },
      labels: { type: 'array', description: 'Parsed labels (simple/series shape).' },
      values: { type: 'array', description: 'Parsed values (simple shape).' },
      series: { type: 'array', description: 'Parsed series (series shape).' },
      cohorts: { type: 'array', description: 'Parsed cohorts (cohort shape).' },
      result: { type: 'string', description: 'Alias for data_json.' },
    },
    async (inputs, ctx) => {
      const csvRaw = String(inputs.csv ?? '');
      const path = String(inputs.path ?? '');
      const shape = String(inputs.shape ?? 'simple');

      let text = csvRaw;
      if (!text && path) {
        const { readFileSync } = await import('node:fs');
        const { resolve, isAbsolute, join } = await import('node:path');
        const abs = isAbsolute(path) ? path : resolve(join(ctx.workingDirectory ?? process.cwd(), path));
        text = readFileSync(abs, 'utf-8');
      }
      if (!text.trim()) {
        throw new Error('csv-to-chart-json: provide non-empty `csv` or a readable `path`.');
      }

      const rows = parseCsv(text);
      if (rows.length < 2) {
        throw new Error('csv-to-chart-json: CSV must have a header row plus at least one data row.');
      }
      const header = rows[0];
      const body = rows.slice(1);

      if (shape === 'simple') {
        // First column → labels, second column → values (numeric).
        if (header.length < 2) throw new Error('simple shape: need at least 2 columns (label,value).');
        const labels = body.map((r) => r[0] ?? '');
        const values = body.map((r) => toNumber(r[1], header[1]));
        const data = { labels, values };
        return { ...data, data_json: JSON.stringify(data), result: JSON.stringify(data) };
      }

      if (shape === 'series') {
        // First column → labels, remaining columns → series (header row = series names).
        if (header.length < 2) throw new Error('series shape: need at least 2 columns (label + one series).');
        const labels = body.map((r) => r[0] ?? '');
        const series = header.slice(1).map((name, i) => ({
          name,
          values: body.map((r) => toNumber(r[i + 1], name)),
        }));
        const data = { labels, series };
        return { ...data, data_json: JSON.stringify(data), result: JSON.stringify(data) };
      }

      if (shape === 'cohort') {
        // Columns: date,size,value_0,value_1,...
        if (header.length < 3) throw new Error('cohort shape: need at least 3 columns (date,size,value0,...).');
        const cohorts = body.map((r) => ({
          date: r[0] ?? '',
          size: toNumber(r[1], header[1]),
          values: r.slice(2).map((v, i) => toNumber(v, header[i + 2])),
        }));
        const data = { cohorts };
        return { ...data, data_json: JSON.stringify(data), result: JSON.stringify(data) };
      }

      throw new Error(`csv-to-chart-json: unknown shape "${shape}". Use simple | series | cohort.`);
    },
  ),
];

function toNumber(raw: string | undefined, column: string): number {
  const v = Number(String(raw ?? '').trim());
  if (Number.isNaN(v)) throw new Error(`csv-to-chart-json: "${raw}" in column "${column}" is not a number.`);
  return v;
}

/**
 * Minimal CSV parser. Supports double-quoted fields and escaped quotes ("")
 * inside quoted fields. Does NOT support multi-line quoted fields.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    rows.push(parseCsvLine(line));
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"' && cur === '') { inQuotes = true; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const REGISTRY = new Map<string, BuiltinToolEntry>();
for (const entry of BUILTINS) {
  REGISTRY.set(entry.definition.id, entry);
}

export function getBuiltinTool(id: string): BuiltinToolEntry | undefined {
  return REGISTRY.get(id);
}

export function listBuiltinTools(): ToolDefinition[] {
  return BUILTINS.map((e) => e.definition);
}

export function isBuiltinTool(id: string): boolean {
  return REGISTRY.has(id);
}
