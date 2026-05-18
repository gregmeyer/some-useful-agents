/**
 * Single source of truth for LLM provider metadata.
 *
 * Every place that needs to know about a provider (the spawner, the
 * install-check, the dashboard's "you have X installed" hint, the tool
 * catalog) reads from PROVIDERS. Adding a new provider is one entry
 * here plus a `LlmProvider` union member.
 */

export type LlmProvider = 'claude' | 'codex';

export interface ProviderDef {
  id: LlmProvider;
  /** Human-readable name for UI ("Claude Code", "Codex"). */
  displayName: string;
  /** Binary name resolved against PATH. */
  binary: string;
  /** Argv used by `detectLlms()` to probe install + version. */
  versionArgv: readonly string[];
  /** Build the argv for a single-prompt invocation. */
  promptArgv: (prompt: string) => string[];
}

export const PROVIDERS: Record<LlmProvider, ProviderDef> = {
  claude: {
    id: 'claude',
    displayName: 'Claude Code',
    binary: 'claude',
    versionArgv: ['--version'],
    promptArgv: (prompt) => ['--print', prompt],
  },
  codex: {
    id: 'codex',
    displayName: 'Codex',
    binary: 'codex',
    versionArgv: ['--version'],
    promptArgv: (prompt) => ['exec', '-s', 'read-only', prompt],
  },
};

export const PROVIDER_IDS: readonly LlmProvider[] = Object.keys(PROVIDERS) as LlmProvider[];
