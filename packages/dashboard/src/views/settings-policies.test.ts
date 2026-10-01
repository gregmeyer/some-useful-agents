import { describe, it, expect } from 'vitest';
import { evaluatePolicy, type PolicyDocument } from '@some-useful-agents/core';
import { renderSettingsPolicies } from './settings-policies.js';

const doc: PolicyDocument = {
  version: 1,
  defaultAction: 'allow',
  rules: [
    { tool: 'web-fetch', action: 'execute', resources: [], effect: 'deny', reason: 'No web by default.' },
    { tool: 'web-fetch', action: 'execute', resources: ['https://docs.example.com/*'], effect: 'allow' },
    { tool: 'shell-exec', action: 'execute', resources: [], effect: 'deny', conditions: { source: ['community'] } },
  ],
};
const base = { path: '/data/.sua/policies.json', toolIds: ['web-fetch', 'shell-exec'] };

describe('Settings → Policies', () => {
  it('says everything is allowed when there is no file', () => {
    const html = String(renderSettingsPolicies({ ...base, exists: false, doc: { version: 1, defaultAction: 'allow', rules: [] } }));
    expect(html).toContain('No policy file yet, so every tool call is allowed');
    expect(html).toContain('Would this be allowed?');
  });

  it('lists the rules in order, with the default action and who they apply to', () => {
    const html = String(renderSettingsPolicies({ ...base, exists: true, doc }));
    expect(html).toContain('id="rule-0"');
    expect(html).toContain('https://docs.example.com/*');
    expect(html).toContain('No web by default.');
    expect(html).toMatch(/community<\/td>/);
    expect(html).toContain('the <strong>last</strong> one that matches decides');
  });

  it('warns that an invalid file blocks every call', () => {
    const html = String(renderSettingsPolicies({ ...base, exists: true, error: 'rules.0.effect: Invalid enum value' }));
    expect(html).toContain('Every tool call is blocked until this file is fixed.');
    expect(html).toContain('rules.0.effect: Invalid enum value');
    expect(html).not.toContain('id="rule-0"');
  });

  it('shows a check result and highlights the rule that decided it', () => {
    const request = { toolId: 'web-fetch', resource: 'https://docs.example.com/a', agentSource: 'local' as const, agentId: 'x' };
    const decision = evaluatePolicy(doc, request);
    const html = String(renderSettingsPolicies({ ...base, exists: true, doc, check: { tool: 'web-fetch', resource: request.resource, source: 'local', decision } }));
    expect(html).toContain('<strong>Allowed</strong>');
    expect(html).toContain('href="#rule-1">rule #1</a> decided it');
    expect(html).toMatch(/class="is-deciding" id="rule-1"/);
    const denied = evaluatePolicy(doc, { ...request, resource: 'https://elsewhere.com' });
    const html2 = String(renderSettingsPolicies({ ...base, exists: true, doc, check: { tool: 'web-fetch', resource: 'https://elsewhere.com', source: 'local', decision: denied } }));
    expect(html2).toContain('<strong>Blocked</strong>');
    expect(html2).toContain('No web by default.');
  });
});
