import { execSync, type ExecSyncOptions } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  ToolDefinition,
  ToolOutput,
  BuiltinToolEntry,
  BuiltinToolContext,
} from './tool-types.js';

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
      const filePath = resolve(ctx.workingDirectory ?? process.cwd(), String(inputs.path));
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
      const filePath = resolve(ctx.workingDirectory ?? process.cwd(), String(inputs.path));
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
];

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
