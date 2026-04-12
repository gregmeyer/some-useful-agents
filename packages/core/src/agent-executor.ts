import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentDefinition } from './types.js';

export interface ExecutionResult {
  result: string;
  exitCode: number;
  error?: string;
}

export interface ExecutionHandle {
  promise: Promise<ExecutionResult>;
  kill: () => void;
}

export function executeAgent(agent: AgentDefinition, env?: Record<string, string>): ExecutionHandle {
  if (agent.type === 'shell') {
    return executeShellAgent(agent, env);
  }
  return executeClaudeCodeAgent(agent, env);
}

function executeShellAgent(agent: AgentDefinition, prebuiltEnv?: Record<string, string>): ExecutionHandle {
  if (!agent.command) {
    throw new Error(`Shell agent "${agent.name}" has no command`);
  }

  let child: ChildProcess;
  let killed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const promise = new Promise<ExecutionResult>((resolve) => {
    const env = prebuiltEnv ?? { ...process.env, ...(agent.env ?? {}) };

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

function executeClaudeCodeAgent(agent: AgentDefinition, prebuiltEnv?: Record<string, string>): ExecutionHandle {
  if (!agent.prompt) {
    throw new Error(`Claude-code agent "${agent.name}" has no prompt`);
  }

  let child: ChildProcess;
  let killed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const promise = new Promise<ExecutionResult>((resolve) => {
    const args = ['--print', agent.prompt!];
    if (agent.model) { args.push('--model', agent.model); }
    if (agent.maxTurns) { args.push('--max-turns', String(agent.maxTurns)); }
    if (agent.allowedTools?.length) { args.push('--allowedTools', agent.allowedTools.join(',')); }

    const env = prebuiltEnv ?? { ...process.env, ...(agent.env ?? {}) };

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
