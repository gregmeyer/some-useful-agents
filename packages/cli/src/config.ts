import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface SuaConfig {
  provider: 'local' | 'temporal';
  agentsDir: string;
  dataDir: string;
  /** Default port the dashboard binds to. CLI --port still wins per-invocation. */
  dashboardPort?: number;
  /**
   * Base URL the dashboard is reachable at, used to build clickable run
   * links inside notify handler payloads (Slack, etc). Defaults to
   * `http://127.0.0.1:<dashboardPort>`. Override when the dashboard is
   * behind a reverse proxy or bound to a non-loopback host that the
   * notify destination needs to reach.
   */
  dashboardBaseUrl?: string;
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
  /**
   * `sua daemon` settings. Controls which services are managed by default
   * and how aggressively per-service logs are rotated.
   */
  daemon?: {
    /** Services started by `sua daemon start` (with no --service flag). */
    services?: ('schedule' | 'dashboard' | 'mcp')[];
    /** Rotate log when it exceeds this many bytes (rotate-on-start). */
    logRotateBytes?: number;
  };
}

const DEFAULT_CONFIG: SuaConfig = {
  provider: 'local',
  agentsDir: './agents',
  dataDir: './data',
  dashboardPort: 3000,
  mcpPort: 3003,
  temporalAddress: 'localhost:7233',
  temporalNamespace: 'default',
  temporalTaskQueue: 'sua-agents',
  runRetentionDays: 30,
  daemon: {
    services: ['schedule', 'dashboard'],
    logRotateBytes: 10 * 1024 * 1024,
  },
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

export function getDaemonServices(config: SuaConfig): ('schedule' | 'dashboard' | 'mcp')[] {
  return config.daemon?.services ?? ['schedule', 'dashboard'];
}

export function getDaemonLogRotateBytes(config: SuaConfig): number {
  return config.daemon?.logRotateBytes ?? 10 * 1024 * 1024;
}

export function getDashboardPort(config: SuaConfig): number {
  return config.dashboardPort ?? 3000;
}

export function getDashboardBaseUrl(config: SuaConfig): string {
  if (config.dashboardBaseUrl) return config.dashboardBaseUrl.replace(/\/$/, '');
  return `http://127.0.0.1:${getDashboardPort(config)}`;
}
