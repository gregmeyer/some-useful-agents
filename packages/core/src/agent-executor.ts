import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentDefinition } from './types.js';
import { substituteInputs } from './input-resolver.js';

export interface ExecutionResult {
  result: string;
  exitCode: number;
  error?: string;
}

export interface ExecutionHandle {
  promise: Promise<ExecutionResult>;
  kill: () => void;
}

export interface ExecutionOptions {
  /**
   * Set of community-sourced agent names permitted to run as shell type.
   * A shell-type agent with `source === 'community'` not in this set is
   * refused with `UntrustedCommunityShellError` before `spawn` is called.
   * Per-agent, not global, so one stray invocation cannot trust everything.
   */
  allowUntrustedShell?: ReadonlySet<string>;
  /**
   * Resolved input values for this run (already validated against the
   * agent's declared `inputs:` specs — use `resolveInputs` from
   * `input-resolver.ts` upstream to produce this map).
   *
   * For shell agents: entries are merged into the process env, overriding
   * both inherited env and YAML `env:` values — authors reference them as
   * `$VAR` or `"$VAR"`.
   *
   * For claude-code agents: `{{inputs.X}}` tokens in `prompt` are
   * substituted. Entries are ALSO merged into the env for consistency with
   * shell agents, so a tool Claude invokes can read them.
   *
   * In both types, `{{inputs.X}}` tokens in `env:` values are substituted
   * before spawn.
   */
  inputs?: Record<string, string>;
}

/**
 * Thrown by `executeAgent` when a shell-type agent sourced from
 * `community` would run without explicit allow-listing. Community agents
 * get the ambient authority of the user the moment they run — the gate
 * is a forcing function to read the `command:` field first.
 */
export class UntrustedCommunityShellError extends Error {
  constructor(public readonly agent: string) {
    super(
      `Refusing to run community shell agent "${agent}" without explicit opt-in. ` +
        `Shell agents have full filesystem and network access as the invoking user. ` +
        `Audit with \`sua agent audit ${agent}\`, then re-run with ` +
        `\`--allow-untrusted-shell ${agent}\` if the command is safe.`,
    );
    this.name = 'UntrustedCommunityShellError';
  }
}

export function executeAgent(
  agent: AgentDefinition,
  env?: Record<string, string>,
  options: ExecutionOptions = {},
): ExecutionHandle {
  if (agent.type === 'shell') {
    return executeShellAgent(agent, env, options);
  }
  return executeClaudeCodeAgent(agent, env, options);
}

/**
 * Apply `{{inputs.X}}` substitution to an env map's values, then layer
 * the resolved inputs on top so declared inputs win over both ambient env
 * and YAML `env:` values. Pure helper used by both executor paths.
 *
 * Tolerates `undefined` values in the source map (process.env's shape) and
 * drops them from the output — Node's spawn expects string values only.
 */
function mergeInputsIntoEnv(
  baseEnv: Record<string, string | undefined>,
  inputs: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v === undefined) continue;
    out[k] = inputs ? substituteInputs(v, inputs) : v;
  }
  // Declared inputs override (highest-priority source).
  if (inputs) {
    for (const [k, v] of Object.entries(inputs)) {
      out[k] = v;
    }
  }
  return out;
}

function executeShellAgent(
  agent: AgentDefinition,
  prebuiltEnv?: Record<string, string>,
  options: ExecutionOptions = {},
): ExecutionHandle {
  if (!agent.command) {
    throw new Error(`Shell agent "${agent.name}" has no command`);
  }

  // Community shell agents are refused by default — they get user-level
  // ambient authority and no sandbox. Caller must opt in per-agent after
  // auditing the command. See docs/SECURITY.md.
  if (agent.source === 'community' && !options.allowUntrustedShell?.has(agent.name)) {
    throw new UntrustedCommunityShellError(agent.name);
  }

  let child: ChildProcess;
  let killed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const promise = new Promise<ExecutionResult>((resolve) => {
    const baseEnv = prebuiltEnv ?? { ...process.env, ...(agent.env ?? {}) };
    const env = mergeInputsIntoEnv(baseEnv, options.inputs);

    child = spawn('bash', ['-c', agent.command!], {
      cwd: agent.workingDirectory ?? process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout!.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });

    const timeoutMs = (agent.timeout ?? 300) * 1000;
    timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000);
    }, timeoutMs);

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (killed) {
        resolve({ result: stdout, exitCode: 124, error: `Agent timed out after ${agent.timeout ?? 300}s` });
      } else {
        resolve({
          result: stdout,
          exitCode: code ?? 1,
          error: code !== 0 ? stderr || `Process exited with code ${code}` : undefined,
        });
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ result: '', exitCode: 127, error: err.message });
    });
  });

  return {
    promise,
    kill: () => { killed = true; child?.kill('SIGTERM'); },
  };
}

function executeClaudeCodeAgent(
  agent: AgentDefinition,
  prebuiltEnv?: Record<string, string>,
  options: ExecutionOptions = {},
): ExecutionHandle {
  if (!agent.prompt) {
    throw new Error(`Claude-code agent "${agent.name}" has no prompt`);
  }

  let child: ChildProcess;
  let killed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const promise = new Promise<ExecutionResult>((resolve) => {
    // Resolve `{{inputs.X}}` tokens in the prompt before handing to Claude.
    // The schema loader already verified every reference is declared, so
    // substitution is safe — missing inputs would have failed at load time.
    const resolvedPrompt = options.inputs
      ? substituteInputs(agent.prompt!, options.inputs)
      : agent.prompt!;

    const args = ['--print', resolvedPrompt];
    if (agent.model) { args.push('--model', agent.model); }
    if (agent.maxTurns) { args.push('--max-turns', String(agent.maxTurns)); }
    if (agent.allowedTools?.length) { args.push('--allowedTools', agent.allowedTools.join(',')); }

    const baseEnv = prebuiltEnv ?? { ...process.env, ...(agent.env ?? {}) };
    const env = mergeInputsIntoEnv(baseEnv, options.inputs);

    child = spawn('claude', args, {
      cwd: agent.workingDirectory ?? process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout!.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });

    const timeoutMs = (agent.timeout ?? 300) * 1000;
    timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (killed) {
        resolve({ result: stdout, exitCode: 124, error: `Agent timed out after ${agent.timeout ?? 300}s` });
      } else {
        resolve({
          result: stdout,
          exitCode: code ?? 1,
          error: code !== 0 ? stderr || `Claude exited with code ${code}` : undefined,
        });
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      if (err.message.includes('ENOENT')) {
        resolve({ result: '', exitCode: 127, error: 'Claude Code CLI not found. Install it: https://docs.anthropic.com/en/docs/claude-code' });
      } else {
        resolve({ result: '', exitCode: 127, error: err.message });
      }
    });
  });

  return {
    promise,
    kill: () => { killed = true; child?.kill('SIGTERM'); },
  };
}
