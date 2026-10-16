import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CodexModelList } from './codex-models.js';

/** Where the Claude CLI keeps its config and caches: `$CLAUDE_CONFIG_DIR`, else ~/.claude. */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
}

/** Short names the Claude CLI resolves itself; always valid. */
const CLAUDE_ALIASES = ['default', 'opus', 'sonnet', 'haiku', 'fable', 'opusplan', 'best'];

/** `opus[1m]` / `claude-opus-5-5[1m]` → the model id without its context tag. */
export function bareModelId(model: string): string {
  return model.replace(/\[[^\]]*\]$/, '').trim();
}

/**
 * The models the Claude CLI offers this account, read from the catalog it keeps
 * fresh itself (`cache/model-catalog/*-cc.json`). Current models come first,
 * then older ones it still serves. Aliases (`opus`, `sonnet`…) count as known.
 * An unreadable or missing catalog gives an empty list: unknown, not "none".
 */
export function claudeModels(dir: string = claudeConfigDir()): CodexModelList {
  const catalogDir = join(dir, 'cache', 'model-catalog');
  let newest: { path: string; mtime: number } | undefined;
  try {
    for (const name of readdirSync(catalogDir)) {
      if (!name.endsWith('-cc.json')) continue;
      const path = join(catalogDir, name);
      const mtime = statSync(path).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { path, mtime };
    }
  } catch {
    return { models: [], ids: [] };
  }
  if (!newest) return { models: [], ids: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(newest.path, 'utf-8'));
  } catch {
    return { models: [], ids: [] };
  }
  const r = raw as { fetchedAt?: unknown; catalog?: { config?: { models?: unknown; provider_alias_targets?: unknown } } };
  const list = Array.isArray(r.catalog?.config?.models) ? r.catalog!.config!.models as unknown[] : [];
  const known = list.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof (m as Record<string, unknown>).id === 'string');
  if (known.length === 0) return { models: [], ids: [] };
  const rank = (m: Record<string, unknown>) => (m.section === 'main' ? 0 : 1);
  const models = [...known]
    .sort((a, b) => rank(a) - rank(b))
    .map((m) => ({
      id: m.id as string,
      label: typeof m.name === 'string' && m.name ? m.name : (m.id as string),
      desc: typeof m.description === 'string' ? m.description : (m.section === 'main' ? '' : 'Older model, still offered'),
    }));
  const aliasTargets = r.catalog?.config?.provider_alias_targets;
  const aliases = aliasTargets && typeof aliasTargets === 'object' ? Object.keys(aliasTargets) : [];
  const ids = [...new Set([...known.map((m) => m.id as string), ...CLAUDE_ALIASES, ...aliases])];
  return { models, ids, ...(typeof r.fetchedAt === 'number' ? { fetchedAt: new Date(r.fetchedAt).toISOString() } : {}) };
}

/** The `model` in the Claude CLI's own settings.json, if any (read fresh). */
export function claudeConfigModel(dir: string = claudeConfigDir()): string | undefined {
  try {
    const model = (JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8')) as { model?: unknown }).model;
    return typeof model === 'string' && model.trim() ? model.trim() : undefined;
  } catch {
    return undefined;
  }
}
