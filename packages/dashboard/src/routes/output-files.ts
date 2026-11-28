/**
 * Serve agent output files from allowlisted directories.
 * Used by the 'preview' widget field type to render HTML/image outputs inline.
 *
 * Security: only serves files from explicitly allowlisted directories.
 * Path traversal is blocked by resolving to absolute paths and checking
 * the resolved path starts with an allowed directory.
 */

import { Router, type Request, type Response } from 'express';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { hostPathFor, mcpSharedFolders, type McpServerConfig } from '@some-useful-agents/core';
import { getContext } from '../context.js';

export const outputFilesRouter: Router = Router();

/** Default allowlisted directories for agent output files. */
const DEFAULT_ALLOWED_DIRS = [
  './graphics-output',
  './output',
  './agent-output',
  '/tmp/graphics-output',
  '/private/tmp/graphics-output',
];

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.csv': 'text/csv',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

let resolvedAllowed: string[] | null = null;

function getAllowedDirs(): string[] {
  if (resolvedAllowed) return resolvedAllowed;
  // Don't filter by existsSync — directories may be created by agents
  // after the dashboard starts. Existence is checked at request time.
  resolvedAllowed = DEFAULT_ALLOWED_DIRS.map((d) => resolve(d));
  return resolvedAllowed;
}

/**
 * Add a directory to the allowlist at runtime (e.g. from agent config).
 */
export function addAllowedOutputDir(dir: string): void {
  const abs = resolve(dir);
  resolvedAllowed = null; // reset cache
  if (!DEFAULT_ALLOWED_DIRS.includes(dir) && !DEFAULT_ALLOWED_DIRS.includes(abs)) {
    DEFAULT_ALLOWED_DIRS.push(abs);
  }
}

/**
 * Check if a resolved file path is inside an allowed directory, or a folder a
 * Docker-run tool server shares with this computer.
 */
function isAllowed(filePath: string, servers: readonly McpServerConfig[] = [], dataRoot?: string): boolean {
  const abs = resolve(filePath);
  const inside = (dir: string) => abs.startsWith(dir + '/') || abs === dir;
  if (getAllowedDirs().some(inside)) return true;
  // A run's own pictures (a screenshot, a drawing: run-files.ts).
  if (dataRoot && /\.png$/i.test(abs) && inside(resolve(join(dataRoot, 'run-files')))) return true;
  // A shared folder may hold anything its server can see, so only what a
  // server makes to look at (pictures, pages, PDFs) is served from one.
  return SHARED_TYPES.test(abs) && mcpSharedFolders(servers).some((f) => inside(resolve(f.host)));
}

/** What's served from a folder a tool server shares: what it made to look at. */
const SHARED_TYPES = /\.(png|jpe?g|gif|webp|svg|pdf|html?)$/i;

/** The tool servers sua knows (their shared folders), or none. */
export function knownMcpServers(locals: Record<string, unknown>): McpServerConfig[] {
  try { return mcpServersIn(getContext(locals)); } catch { return []; }
}

/** Where sua keeps its data (runs' own files are under it), when known. */
export function dataRootIn(ctx: { agentStore?: { dataRoot?: string } }): string | undefined {
  try { return ctx.agentStore?.dataRoot; } catch { return undefined; }
}

/** The tool servers a context knows, or none. */
export function mcpServersIn(ctx: { toolStore?: { listMcpServers(): McpServerConfig[] } }): McpServerConfig[] {
  try { return ctx.toolStore?.listMcpServers() ?? []; } catch { return []; }
}

/**
 * The file on this computer an agent's output path names, or why it can't be
 * shown. A path a Docker-run tool server reported (inside its container) is
 * read from the folder it shares; one that stayed in the container says so.
 */
export function resolveOutputFile(rawPath: string, servers: readonly McpServerConfig[], dataRoot?: string): { path: string } | { status: number; message: string } {
  if (!rawPath) return { status: 400, message: 'Missing ?path= parameter' };
  const shared = hostPathFor(rawPath, servers);
  if (shared && SHARED_TYPES.test(shared) && existsSync(shared)) return { path: resolve(shared) };
  const absPath = resolve(rawPath);
  if (!isAllowed(absPath, servers, dataRoot)) {
    return { status: 403, message: `File not in an allowed directory. Allowed: ${[...getAllowedDirs(), ...mcpSharedFolders(servers).map((f) => f.host)].join(', ')}` };
  }
  if (!existsSync(absPath)) {
    return { status: 404, message: shared === undefined && servers.some((s) => s.enabled && s.command && /docker|podman/.test(s.command)) ? "File not found. If a tool server running in Docker made it, it saved it inside its container, outside the folder it shares with this computer." : 'File not found' };
  }
  return { path: absPath };
}

/**
 * GET /output-file?path=<absolute-or-relative-path>
 * Serves the file if it's inside an allowlisted directory.
 */
outputFilesRouter.get('/output-file', (req: Request, res: Response) => {
  const rawPath = typeof req.query.path === 'string' ? req.query.path : '';
  let dataRoot: string | undefined;
  try { dataRoot = dataRootIn(getContext(req.app.locals)); } catch { dataRoot = undefined; }
  const found = resolveOutputFile(rawPath, knownMcpServers(req.app.locals), dataRoot);
  if ('status' in found) {
    res.status(found.status).type('text/plain').send(found.message);
    return;
  }
  const absPath = found.path;
  const stat = statSync(absPath);
  if (!stat.isFile()) {
    res.status(400).type('text/plain').send('Not a file');
    return;
  }
  if (stat.size > MAX_FILE_SIZE) {
    res.status(413).type('text/plain').send('File too large (max 10MB)');
    return;
  }

  const ext = extname(absPath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

  try {
    const content = readFileSync(absPath);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Allow HTML files to render with inline styles, fonts, and images.
    // These are user-generated output files, not untrusted third-party content.
    if (ext === '.html' || ext === '.htm') {
      res.setHeader('Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; " +
        "img-src data: https: http:; " +
        "connect-src 'none'; script-src 'none';");
    }
    res.type(contentType).send(content);
  } catch {
    res.status(500).type('text/plain').send('Error reading file');
  }
});
