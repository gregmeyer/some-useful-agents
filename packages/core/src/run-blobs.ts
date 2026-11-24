/**
 * Large strings in a run's stored inputs, kept once.
 *
 * A node's recorded inputs (`node_executions.inputsJson`,
 * `upstreamInputsJson`) and a run's resume context (`runs.resume_context_json`)
 * repeat the same large text run after run: inbox-triage alone stores its
 * ~25 KB kernel, the agent catalog and the runnable specs on every turn, which
 * made those columns most of a 535 MB runs.db. RunStore now stores each string
 * of `BLOB_MIN_CHARS` or more once, in `run_blobs`, keyed by its SHA-256, and
 * the JSON holds `{"$sua_blob": "<hash>"}` in its place. Reading puts the text
 * back, so callers see the JSON exactly as it was written.
 */
import { createHash } from 'node:crypto';

export const BLOB_MIN_CHARS = 4096;
const KEY = '$sua_blob';
const REF_RE = /"\$sua_blob":"([0-9a-f]{64})"/g;

export const blobHash = (body: string): string => createHash('sha256').update(body).digest('hex');

/**
 * Replace each string of `min` chars or more (at any depth) with a reference,
 * calling `put` for each. Returns the JSON unchanged (the same string) when
 * nothing was large enough, or when it isn't JSON.
 */
export function packLargeStrings(json: string | undefined, put: (hash: string, body: string) => void, min = BLOB_MIN_CHARS): string | undefined {
  if (json === undefined || json.length < min) return json;
  let value: unknown;
  try { value = JSON.parse(json); } catch { return json; }
  let packed = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (v.length < min) return v;
      const hash = blobHash(v);
      put(hash, v);
      packed = true;
      return { [KEY]: hash };
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(value);
  return packed ? JSON.stringify(out) : json;
}

/** Put the referenced strings back. A reference whose text is gone reads as a short note. */
export function unpackLargeStrings(json: string | undefined, get: (hash: string) => string | undefined): string | undefined {
  if (json === undefined || !json.includes(`"${KEY}"`)) return json;
  let value: unknown;
  try { value = JSON.parse(json); } catch { return json; }
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      const ref = (v as Record<string, unknown>)[KEY];
      if (keys.length === 1 && typeof ref === 'string') return get(ref) ?? `[stored input ${ref.slice(0, 12)} is no longer kept]`;
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/** The blob hashes a stored JSON refers to. */
export function blobRefs(json: string | null | undefined): string[] {
  if (!json || !json.includes(`"${KEY}"`)) return [];
  return [...json.matchAll(REF_RE)].map((m) => m[1]);
}
