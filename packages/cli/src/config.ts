import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface SuaConfig {
  provider: 'local' | 'temporal';
  agentsDir: string;
  dataDir: string;
  mcpPort: number;
}

const DEFAULT_CONFIG: SuaConfig = {
  provider: 'local',
  agentsDir: './agents',
  dataDir: './data',
  mcpPort: 3003,
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

export function getAgentDirs(config: SuaConfig): { runnable: string[]; catalog: string[] } {
  const base = resolve(config.agentsDir);
  return {
    runnable: [join(base, 'examples'), join(base, 'local')],
    catalog: [join(base, 'community')],
  };
}

export function getDbPath(config: SuaConfig): string {
  return join(resolve(config.dataDir), 'runs.db');
}
