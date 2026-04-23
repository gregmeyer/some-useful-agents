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
import { resolve, extname } from 'node:path';

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
  resolvedAllowed = DEFAULT_ALLOWED_DIRS
    .map((d) => resolve(d))
    .filter((d) => existsSync(d));
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
 * Check if a resolved file path is inside an allowed directory.
 */
function isAllowed(filePath: string): boolean {
  const abs = resolve(filePath);
  return getAllowedDirs().some((dir) => abs.startsWith(dir + '/') || abs === dir);
}

/**
 * GET /output-file?path=<absolute-or-relative-path>
 * Serves the file if it's inside an allowlisted directory.
 */
outputFilesRouter.get('/output-file', (req: Request, res: Response) => {
  const rawPath = typeof req.query.path === 'string' ? req.query.path : '';

  if (!rawPath) {
    res.status(400).type('text/plain').send('Missing ?path= parameter');
    return;
  }

  const absPath = resolve(rawPath);

  // Security: check allowlist.
  if (!isAllowed(absPath)) {
    res.status(403).type('text/plain').send(
      `File not in an allowed directory. Allowed: ${getAllowedDirs().join(', ')}`,
    );
    return;
  }

  // Check file exists and is a regular file.
  if (!existsSync(absPath)) {
    res.status(404).type('text/plain').send('File not found');
    return;
  }
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
