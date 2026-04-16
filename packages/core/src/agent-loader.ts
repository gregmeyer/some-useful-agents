import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { agentDefinitionSchema } from './schema.js';
import type { AgentDefinition } from './types.js';

export type AgentSource = 'examples' | 'local' | 'community';

export interface AgentDirConfig {
  path: string;
  source: AgentSource;
}

export interface LoadAgentsOptions {
  directories: (string | AgentDirConfig)[];
  onWarning?: (file: string, message: string) => void;
}

export interface LoadAgentsResult {
  agents: Map<string, AgentDefinition>;
  warnings: Array<{ file: string; message: string }>;
}

export function loadAgents(options: LoadAgentsOptions): LoadAgentsResult {
  const agents = new Map<string, AgentDefinition>();
  const warnings: Array<{ file: string; message: string }> = [];

  const warn = (file: string, message: string) => {
    warnings.push({ file, message });
    options.onWarning?.(file, message);
  };

  for (const dirEntry of options.directories) {
    const dir = typeof dirEntry === 'string' ? dirEntry : dirEntry.path;
    const source = typeof dirEntry === 'string' ? inferSource(dir) : dirEntry.source;

    if (!existsSync(dir)) {
      warn(dir, `Directory does not exist: ${dir}`);
      continue;
    }

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (err) {
      warn(dir, `Cannot read directory: ${(err as Error).message}`);
      continue;
    }

    for (const entry of entries) {
      const ext = extname(entry).toLowerCase();
      if (ext !== '.yaml' && ext !== '.yml') continue;

      const filePath = join(dir, entry);
      let raw: string;
      try {
        raw = readFileSync(filePath, 'utf-8');
      } catch (err) {
        warn(filePath, `Cannot read file: ${(err as Error).message}`);
        continue;
      }

      if (!raw.trim()) {
        warn(filePath, 'Empty file');
        continue;
      }

      let parsed: unknown;
      try {
        parsed = parseYaml(raw);
      } catch (err) {
        warn(filePath, `Invalid YAML: ${(err as Error).message}`);
        continue;
      }

      // Skip v2 YAML files (id + nodes[]) — they're loaded via AgentStore /
      // sua workflow import, not the v1 loader. Silently skip so the CI
      // validate-agents job doesn't report them as broken v1 files.
      if (typeof parsed === 'object' && parsed !== null && 'id' in parsed && 'nodes' in parsed) {
        continue;
      }

      const result = agentDefinitionSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
        warn(filePath, `Validation failed: ${issues}`);
        continue;
      }

      const agent = result.data as AgentDefinition;
      agent.source = source;
      agent.filePath = filePath;

      if (agents.has(agent.name)) {
        warn(filePath, `Duplicate agent name "${agent.name}" (overwriting previous)`);
      }

      agents.set(agent.name, agent);
    }
  }

  return { agents, warnings };
}

function inferSource(dirPath: string): AgentSource {
  const normalized = dirPath.replace(/\\/g, '/');
  if (normalized.includes('/community')) return 'community';
  if (normalized.includes('/examples')) return 'examples';
  return 'local';
}
