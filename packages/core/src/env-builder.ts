import type { AgentDefinition } from './types.js';

export type TrustLevel = 'local' | 'community';

export interface BuildEnvOptions {
  agent: AgentDefinition;
  trustLevel: TrustLevel;
  secrets?: Record<string, string>;
  processEnv?: Record<string, string | undefined>;
}

export interface BuildEnvResult {
  env: Record<string, string>;
  missingSecrets: string[];
  warnings: string[];
}

// Env vars safe for all agents regardless of trust level
const MINIMAL_ALLOWLIST = ['PATH', 'HOME', 'LANG', 'TERM', 'TMPDIR'];

// Additional env vars for local/trusted agents
const LOCAL_ALLOWLIST = [
  ...MINIMAL_ALLOWLIST,
  'USER', 'SHELL', 'NODE_ENV', 'TZ',
];

// Patterns to match for local trust (e.g. LC_ALL, LC_CTYPE)
const LOCAL_PATTERNS = [/^LC_/];

// Heuristic: keys that suggest the value is a secret
const SECRET_KEY_PATTERNS = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH/i;
const SECRET_VALUE_MIN_LENGTH = 20;

export function buildAgentEnv(options: BuildEnvOptions): BuildEnvResult {
  const { agent, trustLevel, secrets = {}, processEnv = process.env } = options;
  const warnings: string[] = [];
  const missingSecrets: string[] = [];
  const env: Record<string, string> = {};

  // Step 1: Filter process.env based on trust level
  const baseAllowlist = trustLevel === 'community' ? MINIMAL_ALLOWLIST : LOCAL_ALLOWLIST;
  const extraAllowlist = agent.envAllowlist ?? [];
  const allowedKeys = new Set([...baseAllowlist, ...extraAllowlist]);

  for (const [key, value] of Object.entries(processEnv)) {
    if (value === undefined) continue;

    if (allowedKeys.has(key)) {
      env[key] = value;
      continue;
    }

    // For local trust, also match patterns like LC_*
    if (trustLevel === 'local' && LOCAL_PATTERNS.some(p => p.test(key))) {
      env[key] = value;
    }
  }

  // Step 2: Resolve declared secrets
  for (const secretName of agent.secrets ?? []) {
    if (secretName in secrets) {
      env[secretName] = secrets[secretName];
    } else {
      missingSecrets.push(secretName);
    }
  }

  // Step 3: Apply agent's env field (YAML-declared key-values)
  for (const [key, value] of Object.entries(agent.env ?? {})) {
    // Warn if value looks like a hardcoded secret
    if (SECRET_KEY_PATTERNS.test(key) && value.length >= SECRET_VALUE_MIN_LENGTH) {
      warnings.push(
        `Agent "${agent.name}" has env var "${key}" that looks like a hardcoded secret. ` +
        `Use the "secrets" field instead: sua secrets set ${key}`
      );
    }
    env[key] = value;
  }

  return { env, missingSecrets, warnings };
}

export function getTrustLevel(agent: AgentDefinition): TrustLevel {
  if (agent.source === 'community') return 'community';
  return 'local';
}
