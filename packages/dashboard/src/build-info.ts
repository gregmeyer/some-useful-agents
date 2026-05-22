import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface BuildInfo {
  /** Git short SHA at build time (suffixed `-dirty` for an unclean tree), or "dev". */
  commit: string;
  /** ISO build timestamp, or "" when unknown. */
  builtAt: string;
}

/**
 * Build stamp written by `scripts/gen-build-info.mjs` into dist/build-info.json
 * during `npm run build`. Lets the running daemon report exactly which code
 * it's serving (see /health and the footer). Falls back to a dev marker when
 * the file is absent — e.g. running straight from a tsc build without the
 * post-build step, or in tests.
 */
let cached: BuildInfo | null = null;
export function getBuildInfo(): BuildInfo {
  if (cached) return cached;
  try {
    // Compiled to dist/build-info.js; the JSON sits beside it at dist/build-info.json.
    cached = require('./build-info.json') as BuildInfo;
  } catch {
    cached = { commit: 'dev', builtAt: '' };
  }
  return cached;
}
