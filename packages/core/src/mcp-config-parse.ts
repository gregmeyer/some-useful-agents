/**
 * Parse a Claude-Desktop / Cursor / ad-hoc MCP server config blob into
 * a normalised list of server configs. Accepts three shapes:
 *
 *   1. `{ "mcpServers": { "<name>": { ... } } }`   (Claude Desktop)
 *   2. `{ "<name>": { ... } }`                     (bare map)
 *   3. `{ "command": "...", "args": [...] }`       (single anonymous server)
 *
 * For (3) the caller supplies the name via `defaultName`.
 *
 * Input is tried as JSON first, then YAML. Entries whose shape can't
 * be normalised are reported in `errors` rather than thrown, so a
 * partially-valid blob still yields the servers that *are* valid.
 */

import { parse as parseYaml } from 'yaml';
import { mcpServerIdFromKey, type McpServerConfig } from './mcp-server-types.js';

export interface ParsedMcpBlob {
  servers: McpServerConfig[];
  errors: Array<{ key: string; message: string }>;
}

interface RawEntry {
  type?: string;
  transport?: string;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function parseRoot(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('empty config');
  try {
    return JSON.parse(trimmed);
  } catch {
    return parseYaml(trimmed);
  }
}

function normaliseEntry(key: string, raw: unknown): McpServerConfig | { error: string } {
  if (!isPlainObject(raw)) return { error: 'entry is not an object' };
  const e = raw as RawEntry;

  const transportHint = (e.transport ?? e.type) as string | undefined;
  const hasCommand = typeof e.command === 'string' && e.command.length > 0;
  const hasUrl = typeof e.url === 'string' && (e.url as string).length > 0;
  const transport: 'stdio' | 'http' =
    transportHint === 'http' || transportHint === 'stdio'
      ? transportHint
      : hasUrl && !hasCommand
        ? 'http'
        : 'stdio';

  if (transport === 'stdio' && !hasCommand) {
    return { error: 'stdio server requires a "command" field' };
  }
  if (transport === 'http' && !hasUrl) {
    return { error: 'http server requires a "url" field' };
  }

  let args: string[] | undefined;
  if (e.args !== undefined) {
    if (!Array.isArray(e.args) || !e.args.every((x) => typeof x === 'string')) {
      return { error: '"args" must be an array of strings' };
    }
    args = e.args as string[];
  }

  let env: Record<string, string> | undefined;
  if (e.env !== undefined) {
    if (!isPlainObject(e.env)) return { error: '"env" must be an object' };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.env)) {
      if (typeof v !== 'string') return { error: `env value for "${k}" must be a string` };
      out[k] = v;
    }
    env = out;
  }

  const id = mcpServerIdFromKey(key);
  if (!id) return { error: `cannot derive id from key "${key}"` };

  return {
    id,
    name: key,
    transport,
    command: transport === 'stdio' ? (e.command as string) : undefined,
    url: transport === 'http' ? (e.url as string) : undefined,
    args: transport === 'stdio' ? args : undefined,
    env: transport === 'stdio' ? env : undefined,
    enabled: true,
  };
}

export function parseMcpServersBlob(text: string, defaultName = 'server'): ParsedMcpBlob {
  let root: unknown;
  try {
    root = parseRoot(text);
  } catch (err) {
    return { servers: [], errors: [{ key: '<root>', message: `parse failed: ${(err as Error).message}` }] };
  }
  if (!isPlainObject(root)) {
    return { servers: [], errors: [{ key: '<root>', message: 'config must be an object' }] };
  }

  let entries: Array<[string, unknown]>;
  if (isPlainObject(root.mcpServers)) {
    entries = Object.entries(root.mcpServers);
  } else if ('command' in root || 'url' in root) {
    entries = [[defaultName, root]];
  } else {
    entries = Object.entries(root);
  }

  const servers: McpServerConfig[] = [];
  const errors: Array<{ key: string; message: string }> = [];
  const seenIds = new Set<string>();

  for (const [key, raw] of entries) {
    const result = normaliseEntry(key, raw);
    if ('error' in result) {
      errors.push({ key, message: result.error });
      continue;
    }
    if (seenIds.has(result.id)) {
      errors.push({ key, message: `duplicate server id "${result.id}"` });
      continue;
    }
    seenIds.add(result.id);
    servers.push(result);
  }

  return { servers, errors };
}
