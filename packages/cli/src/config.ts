import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface SuaConfig {
  provider: 'local' | 'temporal';
  agentsDir: string;
  dataDir: string;
  mcpPort: number;
  temporalAddress?: string;
  temporalNamespace?: string;
  temporalTaskQueue?: string;
  /**
   * How many days of run history to keep before the startup sweep deletes
   * older rows. Default 30. Set to a high number to effectively disable.
   * Run output can contain secrets echoed by agents; retention limits the
   * ambient leak surface.
   */
  runRetentionDays?: number;
}

const DEFAULT_CONFIG: SuaConfig = {
  provider: 'local',
  agentsDir: './agents',
  dataDir: './data',
  mcpPort: 3003,
  temporalAddress: 'localhost:7233',
  temporalNamespace: 'default',
  temporalTaskQueue: 'sua-agents',
  runRetentionDays: 30,
};

export function loadConfig(): SuaConfig {
  const configPath = join(process.cwd(), 'sua.config.json');
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Resolve which provider to use. Env var SUA_PROVIDER wins over config.
 * CLI --provider flag passed to commands wins over both (handled per-command).
 */
export function resolveProvider(config: SuaConfig, override?: string): 'local' | 'temporal' {
  const choice = override ?? process.env.SUA_PROVIDER ?? config.provider;
  if (choice !== 'local' && choice !== 'temporal') {
    throw new Error(`Invalid provider "${choice}". Must be "local" or "temporal".`);
  }
  return choice;
}

export function getAgentDirs(config: SuaConfig): {
  /** Agents the user authored or ships with sua. No gate needed. */
  runnable: string[];
  /** Third-party community agents. Visible in `agent list --catalog`; runnable with the shell gate. */
  catalog: string[];
  /** Union of `runnable` + `catalog`. Use this for any command that executes an agent — the shell gate in `executeAgent` handles trust enforcement. */
  all: string[];
} {
  const base = resolve(config.agentsDir);
  const runnable = [join(base, 'examples'), join(base, 'local')];
  const catalog = [join(base, 'community')];
  return {
    runnable,
    catalog,
    all: [...runnable, ...catalog],
  };
}

export function getDbPath(config: SuaConfig): string {
  return join(resolve(config.dataDir), 'runs.db');
}

export function getSecretsPath(config: SuaConfig): string {
  return join(resolve(config.dataDir), 'secrets.enc');
}

export function getVariablesPath(config: SuaConfig): string {
  return join(resolve(config.dataDir), '.sua', 'variables.json');
}

export function getRetentionDays(config: SuaConfig): number {
  return config.runRetentionDays ?? 30;
}
