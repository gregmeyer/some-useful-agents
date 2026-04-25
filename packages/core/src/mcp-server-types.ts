/**
 * MCP server as a first-class entity. Multiple tools may be imported
 * from the same server — this record is what groups them so that
 * enable/disable and delete operate on the server rather than N tools.
 */

import { z } from 'zod';

export type McpTransport = 'stdio' | 'http';

export interface McpServerConfig {
  /** Stable slug id, derived from the pasted key (e.g. "modern-graphics"). */
  id: string;
  /** Human-readable name; defaults to id on import. */
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

const MCP_SERVER_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export const mcpServerConfigSchema = z.object({
  id: z.string().regex(MCP_SERVER_ID_RE, 'Server id must be lowercase alnum + hyphens'),
  name: z.string().min(1),
  transport: z.enum(['stdio', 'http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  enabled: z.boolean().default(true),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
}).refine(
  (s) => (s.transport === 'stdio' ? !!s.command : !!s.url),
  { message: 'stdio servers need command, http servers need url' },
);

export function mcpServerIdFromKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
