import { describe, it, expect } from 'vitest';
import { packManifestSchema } from './pack-schema.js';

describe('packManifestSchema', () => {
  it('accepts a minimal pack with only dashboards', () => {
    const m = packManifestSchema.parse({
      id: 'starter',
      name: 'Starter',
      version: '0.1.0',
      dashboards: [{ id: 'media', name: 'Media', sections: [{ title: 'Video', agentIds: ['x'] }] }],
    });
    expect(m.id).toBe('starter');
    expect(m.dashboards).toHaveLength(1);
  });

  it('accepts a pack with only agents', () => {
    const m = packManifestSchema.parse({
      id: 'tools',
      name: 'Tools',
      version: '0.1.0',
      agents: [{ id: 'a', yaml: 'id: a\nname: A\n…' }],
    });
    expect(m.agents).toHaveLength(1);
  });

  it('rejects a pack with neither agents nor dashboards', () => {
    expect(() => packManifestSchema.parse({
      id: 'empty', name: 'Empty', version: '0.1.0',
    })).toThrow(/at least one agent or one dashboard/);
  });

  it('rejects pack id with uppercase', () => {
    expect(() => packManifestSchema.parse({
      id: 'StarterPack', name: 'X', version: '0.1.0',
      dashboards: [{ id: 'd', name: 'D', sections: [{ title: 'T', agentIds: ['a'] }] }],
    })).toThrow(/lowercase/);
  });

  it('rejects non-semver version', () => {
    expect(() => packManifestSchema.parse({
      id: 'x', name: 'X', version: 'v1',
      dashboards: [{ id: 'd', name: 'D', sections: [{ title: 'T', agentIds: ['a'] }] }],
    })).toThrow(/semver/);
  });

  it('rejects empty section agentIds', () => {
    expect(() => packManifestSchema.parse({
      id: 'x', name: 'X', version: '0.1.0',
      dashboards: [{ id: 'd', name: 'D', sections: [{ title: 'T', agentIds: [] }] }],
    })).toThrow(/at least one agent/);
  });

  it('rejects an agent ref with both yaml and yamlPath', () => {
    expect(() => packManifestSchema.parse({
      id: 'x', name: 'X', version: '0.1.0',
      agents: [{ id: 'a', yaml: 'foo', yamlPath: 'bar' }],
    })).toThrow(/yaml or yamlPath/);
  });

  it('accepts an agent ref with id only (no yaml inline)', () => {
    const m = packManifestSchema.parse({
      id: 'x', name: 'X', version: '0.1.0',
      agents: [{ id: 'a' }],
    });
    expect(m.agents?.[0].id).toBe('a');
  });
});
