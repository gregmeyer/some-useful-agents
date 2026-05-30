/**
 * Single source of truth for LLM provider metadata.
 *
 * Every place that needs to know about a provider (the spawner, the
 * install-check, the dashboard's "you have X installed" hint, the tool
 * catalog) reads from PROVIDERS. Adding a new provider is one entry
 * here plus a `LlmProvider` union member.
 */

export type LlmProvider = 'claude' | 'codex' | 'apple-foundation-models';

export interface ProviderDef {
  id: LlmProvider;
  /** Human-readable name for UI ("Claude Code", "Codex"). */
  displayName: string;
  /**
   * Binary name resolved against PATH. For providers that ship a
   * compiled-on-demand runner (e.g. apple-foundation-models), this is a
   * sentinel — the spawner resolves the real path lazily via the
   * runner-bootstrap helper.
   */
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
  // Apple Foundation Models runs on-device via a tiny Swift runner we
  // compile and cache at ~/.sua/runners/apple_foundationmodels. The
  // `binary` here is the resolved cache path returned by
  // ensureAppleRunner(); detectLlms() / invokeLlm() call into the
  // runner module to bootstrap before invoking. The prompt rides on
  // env vars (PROMPT, SYSTEM_PROMPT), not argv — promptArgv returns
  // an empty array and the spawner contributes the env separately.
  'apple-foundation-models': {
    id: 'apple-foundation-models',
    displayName: 'Apple Foundation Models',
    binary: 'apple_foundationmodels',
    versionArgv: ['--version'],
    promptArgv: () => [],
  },
};

export const PROVIDER_IDS: readonly LlmProvider[] = Object.keys(PROVIDERS) as LlmProvider[];
