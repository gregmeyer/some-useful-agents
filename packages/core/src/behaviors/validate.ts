/**
 * Validate one BEHAVIOR.md against the Agent Behavior standard.
 *
 * THE INVARIANT (asserted by conformance.test.ts for every fixture):
 *
 *     result.record !== undefined  ⟺  no diagnostic has severity 'error'
 *
 * That is the standard's "clients SHOULD skip structurally invalid specs and
 * surface a diagnostic rather than load partial or ambiguous content", expressed
 * as a contract a test can hold us to rather than a convention to remember.
 *
 * Collects ALL problems rather than stopping at the first: someone fixing a new
 * spec should see every issue in one pass, not play whack-a-mole.
 */

import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { parseDocument } from 'yaml';
import {
  MAX_BODY_BYTES,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  NAME_PATTERN,
} from './constants.js';
import { splitFrontmatter } from './frontmatter.js';
import type {
  BehaviorDiagnostic,
  BehaviorDiagnosticCode,
  BehaviorLocation,
  BehaviorMetadataValue,
  BehaviorRecord,
} from './types.js';

export interface ValidateBehaviorInput {
  raw: string;
  location: BehaviorLocation;
  maxBodyBytes?: number;
}

export interface ValidateBehaviorResult {
  record?: BehaviorRecord;
  diagnostics: BehaviorDiagnostic[];
}

function isScalar(v: unknown): v is string | number | boolean | null {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

function isMapping(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function validateBehavior(input: ValidateBehaviorInput): ValidateBehaviorResult {
  const { raw, location } = input;
  const maxBodyBytes = input.maxBodyBytes ?? MAX_BODY_BYTES;
  const diagnostics: BehaviorDiagnostic[] = [];

  const add = (
    severity: 'error' | 'warning',
    code: BehaviorDiagnosticCode,
    message: string,
    pos?: { line?: number; column?: number },
  ): void => {
    diagnostics.push({
      severity, code, message,
      file: location.file,
      ...(pos?.line !== undefined ? { line: pos.line } : {}),
      ...(pos?.column !== undefined ? { column: pos.column } : {}),
    });
  };

  const done = (): ValidateBehaviorResult => ({ diagnostics });

  // A NUL byte means someone pointed us at a binary. Parsing it wastes time and
  // produces nonsense diagnostics.
  if (raw.includes('\0')) {
    add('error', 'behavior/binary-content', 'File contains NUL bytes; expected UTF-8 Markdown.');
    return done();
  }

  const split = splitFrontmatter(raw);
  if (!split) {
    add('error', 'behavior/missing-frontmatter',
      'Missing YAML frontmatter. The file must begin with a line containing exactly "---" and close with another.');
    return done();
  }

  const doc = parseDocument(split.yaml, { prettyErrors: true });
  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      // `linePos` is relative to the YAML substring; shift onto real file lines.
      const p = err.linePos?.[0];
      add('error', 'behavior/invalid-yaml', `Invalid YAML in frontmatter: ${err.message}`,
        p ? { line: p.line + split.yamlStartLine - 1, column: p.col } : undefined);
    }
    return done();
  }

  const fm = doc.toJS() as unknown;
  if (fm === null || fm === undefined) {
    add('error', 'behavior/frontmatter-not-mapping', 'Frontmatter is empty; `name` and `description` are required.');
    return done();
  }
  if (!isMapping(fm)) {
    add('error', 'behavior/frontmatter-not-mapping',
      `Frontmatter must be a mapping of keys to values, got ${Array.isArray(fm) ? 'a list' : typeof fm}.`);
    return done();
  }

  // ── name ────────────────────────────────────────────────────────────────
  const rawName = fm.name;
  let name: string | undefined;
  if (rawName === undefined || rawName === null || rawName === '') {
    add('error', 'behavior/missing-name', 'Frontmatter is missing the required `name` field.');
  } else if (typeof rawName !== 'string') {
    add('error', 'behavior/invalid-name', `\`name\` must be a string, got ${typeof rawName}.`);
  } else if (rawName.length > MAX_NAME_LENGTH) {
    add('error', 'behavior/name-too-long',
      `\`name\` is ${rawName.length} characters; the maximum is ${MAX_NAME_LENGTH}.`);
  } else if (!NAME_PATTERN.test(rawName)) {
    add('error', 'behavior/invalid-name',
      `\`name\` must be lowercase letters, numbers, and single hyphens, with no leading or trailing hyphen. Got "${rawName}".`);
  } else {
    name = rawName;
    const dirName = basename(location.dir);
    if (name !== dirName) {
      add('error', 'behavior/name-dir-mismatch',
        `\`name\` is "${name}" but the directory is "${dirName}". They must match. Rename one: ${location.dir}`);
      name = undefined;
    }
  }

  // ── description ─────────────────────────────────────────────────────────
  const rawDesc = fm.description;
  let description: string | undefined;
  if (rawDesc === undefined || rawDesc === null || rawDesc === '') {
    add('error', 'behavior/missing-description', 'Frontmatter is missing the required `description` field.');
  } else if (typeof rawDesc !== 'string') {
    add('error', 'behavior/missing-description', `\`description\` must be a string, got ${typeof rawDesc}.`);
  } else if (rawDesc.trim() === '') {
    add('error', 'behavior/missing-description', '`description` must be non-empty.');
  } else if (rawDesc.length > MAX_DESCRIPTION_LENGTH) {
    add('error', 'behavior/description-too-long',
      `\`description\` is ${rawDesc.length} characters; the maximum is ${MAX_DESCRIPTION_LENGTH}.`);
  } else {
    description = rawDesc;
  }

  // ── license (optional) ──────────────────────────────────────────────────
  let license: string | undefined;
  if (fm.license !== undefined && fm.license !== null) {
    if (typeof fm.license === 'string') license = fm.license;
    else add('warning', 'behavior/invalid-license', `\`license\` must be a string, got ${typeof fm.license}; ignoring it.`);
  }

  // ── metadata (optional) ─────────────────────────────────────────────────
  // Drop bad VALUES, keep the spec. Losing one metadata key should not cost the
  // reader an otherwise perfectly good behavior.
  const metadata: Record<string, BehaviorMetadataValue> = {};
  if (fm.metadata !== undefined && fm.metadata !== null) {
    if (!isMapping(fm.metadata)) {
      add('warning', 'behavior/invalid-metadata',
        `\`metadata\` must be a mapping, got ${Array.isArray(fm.metadata) ? 'a list' : typeof fm.metadata}; ignoring it.`);
    } else {
      for (const [k, v] of Object.entries(fm.metadata)) {
        if (isScalar(v)) metadata[k] = v;
        else if (Array.isArray(v) && v.every(isScalar)) metadata[k] = v as BehaviorMetadataValue;
        else add('warning', 'behavior/invalid-metadata',
          `\`metadata.${k}\` must be a scalar or an array of scalars; dropping it.`);
      }
    }
  }

  // ── body ────────────────────────────────────────────────────────────────
  let body = split.body;
  let bodyTruncated = false;
  if (body.trim() === '') {
    add('warning', 'behavior/empty-body',
      'Behavior body is empty. The body is where the behavior is actually described; frontmatter alone tells a reviewer nothing.');
  }
  if (Buffer.byteLength(body, 'utf8') > maxBodyBytes) {
    // Slice by bytes, then repair any split multi-byte char at the boundary.
    body = Buffer.from(body, 'utf8').subarray(0, maxBodyBytes).toString('utf8').replace(/�$/, '');
    bodyTruncated = true;
    add('warning', 'behavior/body-truncated',
      `Body exceeds ${maxBodyBytes} bytes and was truncated for display.`);
  }

  if (diagnostics.some((d) => d.severity === 'error')) return done();

  // Unreachable unless a required-field branch above forgot to add an error.
  if (name === undefined || description === undefined) {
    add('error', 'behavior/missing-name', 'Behavior is missing a required field.');
    return done();
  }

  return {
    record: {
      name,
      description,
      ...(license !== undefined ? { license } : {}),
      metadata,
      location,
      body,
      bodyTruncated,
      sha256: createHash('sha256').update(raw, 'utf8').digest('hex'),
    },
    diagnostics,
  };
}
