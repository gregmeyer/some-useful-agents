import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, readFileSync } from 'node:fs';
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
  globToRegExp,
  policyResource,
  resolvePolicyDocument,
  savePolicyDocument,
  savePolicyText,
  policyFileVersion,
  readPolicyFileText,
  hasPolicyBackup,
  restorePolicyBackup,
  PolicyConflictError,
  type EnforcedPolicy,
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

const req = (toolId: string, resource = '', agentSource: 'examples' | 'local' | 'community' = 'local') =>
  ({ toolId, resource, agentSource, agentId: 'a1' });
const doc = (rules: Array<Record<string, unknown>>, defaultAction: 'allow' | 'deny' = 'allow'): EnforcedPolicy =>
  policyDocumentSchema.parse({ version: 1, defaultAction, rules });

describe('evaluatePolicy', () => {
  it('allows everything under the default document', () => {
    expect(evaluatePolicy(DEFAULT_POLICY_DOCUMENT, req('http-post', 'https://x'))).toEqual({ effect: 'allow', matchedRuleIndex: -1, reason: undefined });
  });

  it('lets the LAST matching rule decide (narrow allow after a broad deny, and the reverse)', () => {
    const p = doc([
      { tool: 'http-*', effect: 'deny', reason: 'no outbound http' },
      { tool: 'http-get', resources: ['https://api.github.com/*'], effect: 'allow' },
    ]);
    expect(evaluatePolicy(p, req('http-get', 'https://api.github.com/repos/x'))).toMatchObject({ effect: 'allow', matchedRuleIndex: 1 });
    expect(evaluatePolicy(p, req('http-get', 'https://evil.example/x'))).toMatchObject({ effect: 'deny', matchedRuleIndex: 0, reason: 'no outbound http' });
    expect(evaluatePolicy(p, req('http-post', 'https://api.github.com/x'))).toMatchObject({ effect: 'deny', matchedRuleIndex: 0 });
  });

  it('falls back to defaultAction, with a reason when that is deny', () => {
    const p = doc([{ tool: 'json-parse', effect: 'allow' }], 'deny');
    expect(evaluatePolicy(p, req('json-parse')).effect).toBe('allow');
    const denied = evaluatePolicy(p, req('web-fetch', 'https://x'));
    expect(denied).toMatchObject({ effect: 'deny', matchedRuleIndex: -1 });
    expect(denied.reason).toContain('No policy rule allows "web-fetch" on "https://x"');
  });

  it('matches an unknown (empty) resource only with `*`', () => {
    const scoped = doc([{ tool: '*', resources: ['https://ok/*'], effect: 'allow' }], 'deny');
    expect(evaluatePolicy(scoped, req('notion.search')).effect).toBe('deny');
    const star = doc([{ tool: '*', resources: ['*'], effect: 'allow' }], 'deny');
    expect(evaluatePolicy(star, req('notion.search')).effect).toBe('allow');
  });

  it('honours conditions.source', () => {
    const p = doc([{ tool: 'shell-exec', effect: 'deny', conditions: { source: ['community'] } }]);
    expect(evaluatePolicy(p, req('shell-exec', 'ls', 'community')).effect).toBe('deny');
    expect(evaluatePolicy(p, req('shell-exec', 'ls', 'local')).effect).toBe('allow');
  });

  it('writes a default reason for a deny rule without one', () => {
    const d = evaluatePolicy(doc([{ tool: 'file-write', effect: 'deny' }]), req('file-write', '/etc/hosts'));
    expect(d.reason).toBe('Policy rule #0 denies "file-write" on "/etc/hosts".');
  });

  it('denies everything, with the load error as the reason, on a fail-closed document', () => {
    const d = evaluatePolicy({ ...DEFAULT_POLICY_DOCUMENT, invalidReason: 'broken' }, req('json-parse'));
    expect(d).toEqual({ effect: 'deny', reason: 'broken', matchedRuleIndex: -1 });
  });
});

describe('globToRegExp', () => {
  it('treats * as any run (including /), ? as one char, the rest literally', () => {
    expect(globToRegExp('https://api.github.com/*').test('https://api.github.com/a/b?c=1')).toBe(true);
    expect(globToRegExp('https://api.github.com/*').test('https://api.github.com.evil/x')).toBe(false);
    expect(globToRegExp('file-?rite').test('file-write')).toBe(true);
    expect(globToRegExp('csv.*').test('csvXread')).toBe(false); // the dot is literal
    expect(globToRegExp('a+b(c)').test('a+b(c)')).toBe(true);
  });
});

describe('policyResource', () => {
  it('picks the primary resource per tool', () => {
    expect(policyResource('web-fetch', { url: 'https://x' })).toBe('https://x');
    expect(policyResource('http-post', { endpoint: 'https://y' })).toBe('https://y');
    expect(policyResource('shell-exec', { command: 'ls -la' })).toBe('ls -la');
    expect(policyResource('json-parse', { text: '{}' })).toBe('');
  });

  it('resolves file paths to absolute, against the working directory', () => {
    expect(policyResource('file-write', { path: 'out/a.txt' }, '/proj')).toBe('/proj/out/a.txt');
    expect(policyResource('file-read', { path: '/etc/hosts' }, '/proj')).toBe('/etc/hosts');
    expect(policyResource('file-read', { path: '../secret' }, '/proj/sub')).toBe('/proj/secret');
  });
});

describe('resolvePolicyDocument', () => {
  it('returns the allow-all default when there is no file', () => {
    expect(resolvePolicyDocument(dir)).toBe(DEFAULT_POLICY_DOCUMENT);
  });

  it('fails CLOSED on an invalid file, naming the problem', () => {
    writeDoc('{ not json');
    const p = resolvePolicyDocument(dir);
    expect(p.invalidReason).toMatch(/Invalid JSON/);
    expect(p.invalidReason).toContain('every tool call is blocked');
    expect(evaluatePolicy(p, req('json-parse')).effect).toBe('deny');
  });

  it('picks up edits without a restart (mtime-keyed cache)', () => {
    writeDoc(JSON.stringify({ version: 1, rules: [] }));
    expect(evaluatePolicy(resolvePolicyDocument(dir), req('web-fetch', 'https://x')).effect).toBe('allow');
    writeDoc(JSON.stringify({ version: 1, rules: [{ tool: 'web-fetch', effect: 'deny' }] }));
    const later = new Date(Date.now() + 5_000);
    utimesSync(policyFilePath(dir), later, later);
    expect(evaluatePolicy(resolvePolicyDocument(dir), req('web-fetch', 'https://x')).effect).toBe('deny');
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

describe('saving the policy (rules editor)', () => {
  const tmp = () => mkdtempSync(join(tmpdir(), 'sua-policy-save-'));
  const doc = { version: 1, defaultAction: 'allow', rules: [{ tool: 'web-fetch', effect: 'deny', reason: 'no web' }] };

  it('validates, writes tidy JSON, and takes effect on the next resolve', () => {
    const dir = tmp();
    expect(resolvePolicyDocument(dir).rules).toEqual([]);
    const { version } = savePolicyDocument(dir, doc, { expectedVersion: '' });
    expect(version).toBe(policyFileVersion(dir));
    expect(JSON.parse(readFileSync(policyFilePath(dir), 'utf-8'))).toEqual({
      version: 1, defaultAction: 'allow', rules: [{ tool: 'web-fetch', effect: 'deny', reason: 'no web' }],
    });
    expect(resolvePolicyDocument(dir).rules).toHaveLength(1);
    expect(() => savePolicyDocument(dir, { version: 1, rules: [{ tool: 'x', effect: 'maybe' }] })).toThrow(/Not saved, the policy is invalid/);
    expect(resolvePolicyDocument(dir).rules).toHaveLength(1); // unchanged
  });

  it('refuses to overwrite a file that changed since it was read', () => {
    const dir = tmp();
    const { version } = savePolicyDocument(dir, doc);
    writeFileSync(policyFilePath(dir), JSON.stringify({ version: 1, rules: [] }));
    expect(() => savePolicyDocument(dir, doc, { expectedVersion: version })).toThrow(PolicyConflictError);
  });

  it('keeps the previous file for Undo, and Undo twice is Redo', () => {
    const dir = tmp();
    savePolicyDocument(dir, doc);
    expect(hasPolicyBackup(dir)).toBe(false);
    const second = savePolicyDocument(dir, { ...doc, defaultAction: 'deny' });
    expect(hasPolicyBackup(dir)).toBe(true);
    const undone = restorePolicyBackup(dir, { expectedVersion: second.version });
    expect(loadPolicyDocument(dir).defaultAction).toBe('allow');
    restorePolicyBackup(dir, { expectedVersion: undone.version });
    expect(loadPolicyDocument(dir).defaultAction).toBe('deny');
  });

  it('saves raw JSON text as written, but only when it is valid', () => {
    const dir = tmp();
    const text = '{ "version": 1, "rules": [ { "tool": "shell-exec", "effect": "deny" } ] }';
    savePolicyText(dir, text);
    expect(readPolicyFileText(dir)).toBe(`${text}\n`);
    expect(() => savePolicyText(dir, '{ nope')).toThrow(/isn't valid JSON/);
  });
});
