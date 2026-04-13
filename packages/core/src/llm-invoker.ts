import { spawn, execSync } from 'node:child_process';

export type LlmProvider = 'claude' | 'codex';

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
}

/** Detect which LLM CLIs are installed on the host. Fast, synchronous. */
export function detectLlms(): LlmAvailability {
  const result: LlmAvailability = {
    claude: { installed: false },
    codex: { installed: false },
  };

  try {
    const v = execSync('claude --version', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    result.claude = { installed: true, version: v };
  } catch {
    // not installed or not on PATH
  }

  try {
    const v = execSync('codex --version', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    result.codex = { installed: true, version: v };
  } catch {
    // not installed
  }

  return result;
}

/**
 * Invoke an LLM CLI with a prompt, return its stdout.
 * Uses --print (claude) / exec -s read-only (codex).
 */
export function invokeLlm(options: LlmInvokeOptions): Promise<LlmInvokeResult> {
  const { prompt, provider, timeoutMs = 60_000 } = options;

  return new Promise((resolve) => {
    const args = provider === 'claude'
      ? ['--print', prompt]
      : ['exec', '-s', 'read-only', prompt];

    const child = spawn(provider, args, {
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
