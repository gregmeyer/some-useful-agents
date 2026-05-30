import { spawn, execSync } from 'node:child_process';
import { ensureAppleRunner } from './apple-foundationmodels-runner.js';
import { PROVIDERS, PROVIDER_IDS, type LlmProvider } from './llm-providers.js';

export interface LlmInvokeOptions {
  prompt: string;
  provider: LlmProvider;
  timeoutMs?: number;
}

export interface LlmInvokeResult {
  output: string;
  error?: string;
  exitCode: number;
}

export interface LlmAvailability {
  claude: { installed: boolean; version?: string };
  codex: { installed: boolean; version?: string };
  'apple-foundation-models': { installed: boolean; version?: string };
}

/** Detect which LLM CLIs are installed on the host. Fast, synchronous. */
export function detectLlms(): LlmAvailability {
  const result: LlmAvailability = {
    claude: { installed: false },
    codex: { installed: false },
    'apple-foundation-models': { installed: false },
  };

  for (const id of PROVIDER_IDS) {
    const def = PROVIDERS[id];

    // Apple FM goes through the runner bootstrap (compile-on-first-use).
    // ensureAppleRunner is idempotent + cheap on cache hit. On non-
    // macOS or hosts without xcrun it returns `unsupported` without
    // raising; we leave `installed: false` in that case.
    if (id === 'apple-foundation-models') {
      const handle = ensureAppleRunner();
      if (handle.status !== 'ready') continue;
      try {
        const v = execSync(
          `${handle.binaryPath} ${def.versionArgv.join(' ')}`,
          { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim();
        result[id] = { installed: true, version: v };
      } catch {
        // Runner compiled but the version probe failed — treat as
        // not installed so the chain doesn't try to use it.
      }
      continue;
    }

    try {
      const v = execSync(
        `${def.binary} ${def.versionArgv.join(' ')}`,
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      result[id] = { installed: true, version: v };
    } catch {
      // not installed or not on PATH
    }
  }

  return result;
}

/**
 * Invoke an LLM CLI with a prompt, return its stdout.
 * Argv shape is provider-specific (see PROVIDERS in llm-providers.ts).
 */
export function invokeLlm(options: LlmInvokeOptions): Promise<LlmInvokeResult> {
  const { prompt, provider, timeoutMs = 60_000 } = options;
  const def = PROVIDERS[provider];

  return new Promise((resolve) => {
    const child = spawn(def.binary, def.promptArgv(prompt), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve({
          output: stdout,
          exitCode: 124,
          error: `${provider} timed out after ${timeoutMs / 1000}s`,
        });
        return;
      }
      resolve({
        output: stdout,
        exitCode: code ?? 1,
        error: code !== 0 ? (stderr || `${provider} exited with code ${code}`) : undefined,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.message.includes('ENOENT')) {
        resolve({
          output: '',
          exitCode: 127,
          error: `${provider} CLI not found on PATH. Install it and retry.`,
        });
      } else {
        resolve({ output: '', exitCode: 127, error: err.message });
      }
    });
  });
}
