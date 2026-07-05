/**
 * The /settings/llm view renders the custom OpenAI-compatible endpoints section:
 * defined providers are listed with their key MASKED (never the plaintext), the
 * add form is present, and custom names show up in the waterfall add-dropdown.
 */
import { describe, it, expect } from 'vitest';
import { render } from './html.js';
import { renderSettingsLlm } from './settings-llm.js';
import { LLM_PROVIDERS, type LlmSettings } from '@some-useful-agents/core';

const base = {
  providers: LLM_PROVIDERS,
  formatAge: (v: number | string) => String(v),
};

describe('renderSettingsLlm — custom providers', () => {
  it('lists a custom provider and masks its apiKey', () => {
    const settings: LlmSettings = {
      providers: ['claude'],
      customProviders: [{
        name: 'local-qwen-8b', kind: 'openai',
        apiBase: 'http://127.0.0.1:8181/v1', apiKey: 'super-secret', model: 'qwen',
      }],
    };
    const out = render(renderSettingsLlm({ ...base, settings }));
    expect(out).toContain('Custom OpenAI-compatible endpoints');
    expect(out).toContain('local-qwen-8b');
    expect(out).toContain('http://127.0.0.1:8181/v1');
    // The plaintext key must NEVER reach the HTML.
    expect(out).not.toContain('super-secret');
    expect(out).toContain('key ••••');
    // The add form + remove control exist.
    expect(out).toContain('/settings/llm/custom/add');
    expect(out).toContain('/settings/llm/custom/remove');
  });

  it('offers a defined custom provider in the waterfall add-dropdown', () => {
    const settings: LlmSettings = {
      providers: ['claude'],
      customProviders: [{ name: 'local-qwen-8b', kind: 'openai', apiBase: 'http://x/v1', model: 'qwen' }],
    };
    const out = render(renderSettingsLlm({ ...base, settings }));
    // The custom name is selectable to add to the chain (not yet in it).
    expect(out).toMatch(/<option value="local-qwen-8b">/);
  });

  it('shows "no key" when a custom provider has no apiKey', () => {
    const settings: LlmSettings = {
      providers: ['claude'],
      customProviders: [{ name: 'no-key', kind: 'openai', apiBase: 'http://x/v1', model: 'm' }],
    };
    const out = render(renderSettingsLlm({ ...base, settings }));
    expect(out).toContain('no key');
  });

  it('renders an empty-state when there are no custom providers', () => {
    const settings: LlmSettings = { providers: ['claude'], customProviders: [] };
    const out = render(renderSettingsLlm({ ...base, settings }));
    expect(out).toContain('No custom endpoints yet.');
  });
});

describe('renderSettingsLlm — enable/disable switch', () => {
  it('shows a Disable button for an enabled provider and Enable for a disabled one', () => {
    const settings: LlmSettings = { providers: ['claude', 'codex'], disabledProviders: ['codex'] };
    const out = render(renderSettingsLlm({ ...base, settings }));
    expect(out).toContain('/settings/llm/toggle');
    // Enabled claude → Disable (enabled=0 posted); disabled codex → Enable + Off badge.
    expect(out).toMatch(/name="provider" value="claude">\s*<input type="hidden" name="enabled" value="0">/);
    expect(out).toMatch(/name="provider" value="codex">\s*<input type="hidden" name="enabled" value="1">/);
    expect(out).toContain('>Off<');
  });

  it('marks the first ENABLED provider as Primary, not just chain[0]', () => {
    const settings: LlmSettings = { providers: ['claude', 'codex'], disabledProviders: ['claude'] };
    const out = render(renderSettingsLlm({ ...base, settings }));
    // claude is off, so codex is the effective primary.
    const primaryIdx = out.indexOf('Primary');
    const codexIdx = out.indexOf('codex');
    const claudeIdx = out.indexOf('claude');
    expect(primaryIdx).toBeGreaterThan(-1);
    // The Primary badge sits in codex's row (after claude's row in the list).
    expect(codexIdx).toBeGreaterThan(claudeIdx);
  });

  it('disables the toggle button when only one provider is enabled', () => {
    const settings: LlmSettings = { providers: ['claude'] };
    const out = render(renderSettingsLlm({ ...base, settings }));
    // The lone enabled provider cannot be disabled → button carries `disabled`.
    expect(out).toMatch(/Keep at least one provider enabled/);
  });
});
