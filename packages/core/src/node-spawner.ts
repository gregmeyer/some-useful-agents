/**
 * Process spawning for DAG node execution. Handles shell (bash -c) and
 * claude-code (claude --print) spawn paths with timeout, error
 * categorization, and template resolution. Extracted from dag-executor.ts.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { Agent, AgentNode, NodeErrorCategory } from './agent-v2-types.js';
import type { ExecutionResult } from './agent-executor.js';
import { substituteInputs } from './input-resolver.js';
import { resolveUpstreamTemplate, resolveVarsTemplate } from './node-templates.js';

export type SpawnResult = ExecutionResult & { category?: NodeErrorCategory };

export type SpawnNodeFn = (
  node: AgentNode,
  env: Record<string, string>,
  opts: { agentId: string; agentSource: Agent['source']; allowUntrustedShell?: ReadonlySet<string> },
) => Promise<SpawnResult>;

/**
 * Production spawner for DAG nodes. Handles shell (bash -c) and
 * claude-code (claude --print) execution paths.
 *
 * Categorisation:
 *   - exit code 124 = timeout (SIGTERM convention)
 *   - exit code 127 = spawn failure (ENOENT / EACCES)
 *   - any other non-zero = exit_nonzero
 */
export async function spawnNodeReal(
  node: AgentNode,
  env: Record<string, string>,
  _opts: { agentId: string; agentSource: Agent['source']; allowUntrustedShell?: ReadonlySet<string> },
): Promise<SpawnResult> {
  if (node.type === 'shell') {
    if (!node.command) {
      return { result: '', exitCode: 1, error: `Shell node "${node.id}" has no command`, category: 'setup' };
    }
    return spawnProcess('bash', ['-c', node.command], {
      cwd: node.workingDirectory,
      env,
      timeoutSec: node.timeout ?? 300,
    });
  }

  // claude-code — resolve {{inputs.X}}, {{upstream.X.result}}, {{vars.X}}
  // in the prompt before passing to the CLI.
  if (!node.prompt) {
    return { result: '', exitCode: 1, error: `Claude-code node "${node.id}" has no prompt`, category: 'setup' };
  }
  let resolvedPrompt = node.prompt;
  const upstreamMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    const m = k.match(/^UPSTREAM_(.+)_RESULT$/);
    if (m) upstreamMap[m[1].toLowerCase().replace(/_/g, '-')] = v;
  }
  resolvedPrompt = resolveUpstreamTemplate(resolvedPrompt, upstreamMap);
  resolvedPrompt = resolveVarsTemplate(resolvedPrompt, env);
  resolvedPrompt = substituteInputs(resolvedPrompt, env);
  const args = ['--print', resolvedPrompt];
  if (node.model) { args.push('--model', node.model); }
  if (node.maxTurns) { args.push('--max-turns', String(node.maxTurns)); }
  if (node.allowedTools?.length) { args.push('--allowedTools', node.allowedTools.join(',')); }
  return spawnProcess('claude', args, {
    cwd: node.workingDirectory,
    env,
    timeoutSec: node.timeout ?? 300,
  });
}

/**
 * Low-level process spawn with timeout and exit-code categorization.
 */
export async function spawnProcess(
  bin: string,
  args: string[],
  opts: { cwd?: string; env: Record<string, string>; timeoutSec: number },
): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve) => {
    let child: ChildProcess;
    let killed = false;
    try {
      child = spawn(bin, args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ result: '', exitCode: 127, error: (err as Error).message, category: 'spawn_failure' });
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr!.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000);
    }, opts.timeoutSec * 1000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve({ result: stdout, exitCode: 124, error: `Timed out after ${opts.timeoutSec}s`, category: 'timeout' });
      } else if (code === 0) {
        resolve({ result: stdout, exitCode: 0 });
      } else {
        resolve({
          result: stdout,
          exitCode: code ?? 1,
          error: stderr || `Process exited with code ${code}`,
          category: 'exit_nonzero',
        });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ result: '', exitCode: 127, error: err.message, category: 'spawn_failure' });
    });
  });
}
