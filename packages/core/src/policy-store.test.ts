import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadPolicyDocument,
  evaluatePolicy,
  policyDocumentSchema,
  policyFilePath,
  PolicyLoadError,
  PolicyDeniedError,
  DEFAULT_POLICY_DOCUMENT,
} from './policy-store.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sua-policy-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function writeDoc(content: string): void {
  mkdirSync(join(dir, '.sua'), { recursive: true });
  writeFileSync(join(dir, '.sua', 'policies.json'), content);
}

describe('loadPolicyDocument', () => {
  it('returns the default allow-all document when no file exists', () => {
    const doc = loadPolicyDocument(dir);
    expect(doc).toEqual(DEFAULT_POLICY_DOCUMENT);
    expect(doc.defaultAction).toBe('allow');
    expect(doc.rules).toEqual([]);
  });

  it('parses a minimal valid document', () => {
    writeDoc(JSON.stringify({ version: 1, rules: [] }));
    const doc = loadPolicyDocument(dir);
    expect(doc.version).toBe(1);
    expect(doc.defaultAction).toBe('allow');
  });

  it('parses a document with rules', () => {
    writeDoc(JSON.stringify({
      version: 1,
      defaultAction: 'allow',
      rules: [
        { tool: 'http-post', effect: 'deny', resources: ['*'], reason: 'no egress' },
        { tool: 'file-write', effect: 'allow', resources: ['./data/*'] },
      ],
    }));
    const doc = loadPolicyDocument(dir);
    expect(doc.rules).toHaveLength(2);
    expect(doc.rules[0].effect).toBe('deny');
    expect(doc.rules[0].action).toBe('execute'); // schema default
    expect(doc.rules[1].resources).toEqual(['./data/*']);
  });

  it('throws PolicyLoadError on malformed JSON', () => {
    writeDoc('{ this is not json');
    let err: unknown;
    try { loadPolicyDocument(dir); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(PolicyLoadError);
    expect((err as PolicyLoadError).path).toBe(policyFilePath(dir));
    expect((err as PolicyLoadError).message).toMatch(/Invalid JSON/);
  });

  it('throws PolicyLoadError on schema validation failure', () => {
    writeDoc(JSON.stringify({ version: 1, rules: [{ tool: 'http-get' /* missing effect */ }] }));
    expect(() => loadPolicyDocument(dir)).toThrow(/schema validation failed/);
  });

  it('rejects non-1 version numbers (locks the format for future migrations)', () => {
    writeDoc(JSON.stringify({ version: 2, rules: [] }));
    expect(() => loadPolicyDocument(dir)).toThrow();
  });

  it('rejects unknown effect values', () => {
    writeDoc(JSON.stringify({ version: 1, rules: [{ tool: 'http-get', effect: 'maybe' }] }));
    expect(() => loadPolicyDocument(dir)).toThrow();
  });
});

describe('policyDocumentSchema', () => {
  it('parses an empty rules array', () => {
    expect(() => policyDocumentSchema.parse({ version: 1, rules: [] })).not.toThrow();
  });

  it('fills defaults: defaultAction=allow, rules=[]', () => {
    const parsed = policyDocumentSchema.parse({ version: 1 });
    expect(parsed.defaultAction).toBe('allow');
    expect(parsed.rules).toEqual([]);
  });

  it('rejects rules with unknown action types', () => {
    expect(() => policyDocumentSchema.parse({
      version: 1,
      rules: [{ tool: 'http-get', effect: 'allow', action: 'mutate' }],
    })).toThrow();
  });

  it('accepts conditions.source array of valid sources', () => {
    const parsed = policyDocumentSchema.parse({
      version: 1,
      rules: [{ tool: 'shell-exec', effect: 'deny', conditions: { source: ['community'] } }],
    });
    expect(parsed.rules[0].conditions?.source).toEqual(['community']);
  });
});

describe('evaluatePolicy (PR B stub)', () => {
  it('always returns allow against the default document', () => {
    const decision = evaluatePolicy(DEFAULT_POLICY_DOCUMENT, {
      toolId: 'http-get',
      resource: 'https://example.com/',
      agentSource: 'local',
      agentId: 'a1',
    });
    expect(decision.effect).toBe('allow');
    expect(decision.matchedRuleIndex).toBe(-1);
  });

  it('always returns allow even against a doc with deny rules (stub)', () => {
    // Sanity: the stub ignores rules. PR C flips this and adds tests
    // that exercise the real eval logic; for now we just lock in that
    // PR B does not accidentally start denying anything.
    const decision = evaluatePolicy({
      version: 1,
      defaultAction: 'allow',
      rules: [{ tool: '*', action: 'execute', resources: ['*'], effect: 'deny' }],
    }, {
      toolId: 'http-post',
      resource: '*',
      agentSource: 'community',
      agentId: 'a1',
    });
    expect(decision.effect).toBe('allow');
  });
});

describe('PolicyDeniedError', () => {
  it('carries the tool, resource, and rule index for downstream surfaces', () => {
    const err = new PolicyDeniedError('Custom reason', 'http-post', 'https://evil/', 3);
    expect(err.name).toBe('PolicyDeniedError');
    expect(err.toolId).toBe('http-post');
    expect(err.resource).toBe('https://evil/');
    expect(err.matchedRuleIndex).toBe(3);
  });
});
