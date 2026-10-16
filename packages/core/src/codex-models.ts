import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** A model the Codex CLI offers this account. */
export interface CodexModel {
  id: string;
  label: string;
  desc: string;
}

export interface CodexModelList {
  /** Offered models, Codex's own order (best first). Empty when unknown. */
  models: CodexModel[];
  /** Every id Codex knows for this account, hidden ones too. */
  ids: string[];
  /** When Codex last fetched the list (ISO), if known. */
  fetchedAt?: string;
}

/** Where Codex keeps its config and caches: `$CODEX_HOME`, else ~/.codex. */
export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME?.trim() || join(homedir(), '.codex');
}

/**
 * The models Codex offers right now, read from the list the Codex CLI keeps
 * fresh itself (`models_cache.json`, fetched from OpenAI for the signed-in
 * account). Hidden models (internal reviewers, reserves) are left out. An
 * unreadable or missing file gives an empty list: unknown, not "none".
 */
export function codexModels(home: string = codexHome()): CodexModelList {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(home, 'models_cache.json'), 'utf-8'));
  } catch {
    return { models: [], ids: [] };
  }
  const r = raw as { models?: unknown; fetched_at?: unknown };
  const list = Array.isArray(r.models) ? r.models : [];
  const known = list
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof (m as Record<string, unknown>).slug === 'string');
  const models = known
    .filter((m) => m.visibility === undefined || m.visibility === 'list')
    .sort((a, b) => (typeof a.priority === 'number' ? a.priority : 99) - (typeof b.priority === 'number' ? b.priority : 99))
    .map((m) => ({
      id: m.slug as string,
      label: typeof m.display_name === 'string' && m.display_name ? m.display_name : (m.slug as string),
      desc: typeof m.description === 'string' ? m.description : '',
    }));
  return { models, ids: known.map((m) => m.slug as string), ...(typeof r.fetched_at === 'string' ? { fetchedAt: r.fetched_at } : {}) };
}

/** The `model = "…"` line of Codex's own config.toml, if any (read fresh). */
export function codexConfigModel(home: string = codexHome()): string | undefined {
  try {
    return /^\s*model\s*=\s*"([^"]+)"/m.exec(readFileSync(join(home, 'config.toml'), 'utf-8'))?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Pull the refused model's id out of a provider's error text, e.g. Codex's
 * "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account."
 */
export function refusedModelId(error: string | undefined): string | undefined {
  if (!error) return undefined;
  const m = /issue with the selected model \(([\w.:/\[\]-]+)\)/i.exec(error)
    ?? /[`'"]([\w.:/-]+)[`'"]\s+model\s+(?:is not supported|does not exist|not found)/i.exec(error)
    ?? /model\s+[`'"]([\w.:/-]+)[`'"]\s+(?:is not supported|does not exist|not found)/i.exec(error)
    ?? /model_not_found[^`'"]*[`'"]([\w.:/-]+)[`'"]/i.exec(error);
  return m?.[1];
}

/**
 * Is `model` one Codex no longer offers? Only answerable when Codex's list is
 * known; an unknown list never calls a model obsolete.
 */
export function codexModelRetired(model: string | undefined, list: CodexModelList): boolean {
  if (!model || list.ids.length === 0) return false;
  // `[1m]`-style context tags (Claude) aren't part of the id.
  const bare = model.replace(/\[[^\]]*\]$/, '').trim();
  return !list.ids.includes(bare);
}

/** Same check, by its provider-neutral name. */
export const modelRetired = codexModelRetired;
/** A provider's offered models (Codex's shape is the shared one). */
export type ProviderModelList = CodexModelList;
