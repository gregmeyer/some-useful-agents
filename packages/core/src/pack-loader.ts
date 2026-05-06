/**
 * Built-in pack discovery + registration.
 *
 * On daemon start, the loader scans `packages/core/packs/*.yaml`, parses
 * each manifest, resolves any `yamlPath` agent refs against the manifest
 * file's directory, and upserts the result into PacksStore as
 * `source = 'builtin'`. Idempotent — re-running on each daemon start
 * picks up version/manifest changes without toggling install state
 * (PacksStore.upsertPack preserves installed_at).
 *
 * Note: the loader registers packs but does NOT install them. Users
 * decide what to install via `/packs` (PR 3) or `installPack()` directly.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { packManifestSchema, type PackManifestParsed } from './pack-schema.js';
import type { PacksStore, PackManifest, PackAgentRef } from './packs-store.js';

/**
 * Default location of bundled packs relative to this loader file.
 *
 * In repo: `packages/core/src/pack-loader.ts` is compiled to
 * `packages/core/dist/pack-loader.js`. The packs dir lives at
 * `packages/core/packs/`, i.e. one level up from `dist/`.
 *
 * In an npm install: same shape — `dist/` and `packs/` are siblings
 * under `node_modules/@some-useful-agents/core/`.
 */
export function defaultBuiltinPacksDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'packs');
}

export interface LoadBuiltinPacksResult {
  registered: string[];
  skipped: Array<{ file: string; reason: string }>;
}

/**
 * Read every `*.yaml` in `packsDir`, validate, resolve yamlPath refs, and
 * upsert into the store. Failures on individual files are skipped (logged
 * via the returned `skipped` array) so one broken pack doesn't gate the
 * rest. Returns the ids of packs successfully registered.
 */
export function loadBuiltinPacks(
  packsStore: PacksStore,
  packsDir: string,
): LoadBuiltinPacksResult {
  const result: LoadBuiltinPacksResult = { registered: [], skipped: [] };
  if (!existsSync(packsDir) || !statSync(packsDir).isDirectory()) return result;

  const files = readdirSync(packsDir).filter((f) => f.endsWith('.yaml'));
  for (const file of files) {
    const fullPath = join(packsDir, file);
    try {
      const raw = readFileSync(fullPath, 'utf-8');
      const parsed = parseYaml(raw) as unknown;
      const manifest = packManifestSchema.parse(parsed);
      const inlined = inlineAgentYamlRefs(manifest, dirname(fullPath));
      packsStore.upsertPack({
        id: inlined.id,
        name: inlined.name,
        description: inlined.description ?? null,
        version: inlined.version,
        author: inlined.author ?? null,
        source: 'builtin',
        manifest: inlined,
      });
      result.registered.push(inlined.id);
    } catch (err) {
      result.skipped.push({
        file,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

/**
 * Replace any `yamlPath` agent refs in the manifest with the file's
 * contents under `yaml`. Throws if a referenced file is missing —
 * a built-in pack with a dangling reference is a build/release bug.
 */
function inlineAgentYamlRefs(manifest: PackManifestParsed, baseDir: string): PackManifest {
  const agents: PackAgentRef[] | undefined = manifest.agents?.map((a) => {
    if (a.yamlPath) {
      const abs = resolve(baseDir, a.yamlPath);
      if (!existsSync(abs)) {
        throw new Error(`Agent ref "${a.id}" → yamlPath "${a.yamlPath}" not found at ${abs}`);
      }
      const yaml = readFileSync(abs, 'utf-8');
      return { id: a.id, yaml };
    }
    return { id: a.id, yaml: a.yaml };
  });
  return {
    ...manifest,
    agents,
  };
}
