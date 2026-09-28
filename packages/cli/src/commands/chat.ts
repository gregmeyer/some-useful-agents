import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';
import ora from 'ora';
import {
  SessionStore,
  runAgentTurn,
  reconcileSession,
  resolveChatInput,
  NotConversationalError,
  SessionNotFoundError,
  ChatMessageError,
  type Agent,
  type SessionTurn,
} from '@some-useful-agents/core';
import { loadConfig } from '../config.js';
import { openStores, openV2Deps } from '../v2-runtime.js';
import * as ui from '../ui.js';

/**
 * `sua agent chat` — a conversation with an agent: each message is one run,
 * and the agent sees the conversation so far. See docs/conversations.md.
 */

interface ChatOptions {
  session?: string;
  message?: string;
  list?: boolean;
  show?: boolean;
  input: Record<string, string>;
}

function collectInput(value: string, previous: Record<string, string>): Record<string, string> {
  const eq = value.indexOf('=');
  if (eq <= 0) throw new Error(`--input must be KEY=value (got "${value}")`);
  return { ...previous, [value.slice(0, eq)]: value.slice(eq + 1) };
}

function printTurn(t: SessionTurn): void {
  if (t.role === 'user') {
    console.log(`${chalk.bold('you')}  ${t.text}`);
  } else if (t.failed) {
    console.log(`${chalk.red('agent')} ${ui.dim('(run failed)')} ${t.text}`);
  } else {
    console.log(`${chalk.cyan('agent')} ${t.text}`);
  }
  if (t.role === 'agent' && t.runId) console.log(ui.dim(`       run ${t.runId.slice(0, 8)}`));
}

async function oneTurn(
  agent: Agent,
  sessions: SessionStore,
  deps: ReturnType<typeof openV2Deps>['deps'],
  message: string,
  sessionId: string | undefined,
  inputs: Record<string, string>,
): Promise<{ sessionId: string; ok: boolean }> {
  const spinner = ora({ text: `${agent.id} is working…`, stream: process.stderr }).start();
  try {
    const { sessionId: sid, reply } = await runAgentTurn({
      agent, sessions, message, sessionId, inputs, triggeredBy: 'cli', deps,
    });
    spinner.stop();
    printTurn(reply);
    return { sessionId: sid, ok: !reply.failed };
  } catch (err) {
    spinner.stop();
    throw err;
  }
}

export const chatCommand = new Command('chat')
  .description('Talk to an agent: each message is a run, and the agent sees the conversation so far')
  .argument('<agent>', 'Agent id')
  .option('-s, --session <id>', 'Continue an earlier conversation')
  .option('-m, --message <text>', 'Send one message and exit (no prompt)')
  .option('--list', "List this agent's conversations")
  .option('--show', 'Print the conversation given by --session and exit')
  .option(
    '-i, --input <KEY=value>',
    'Value for another declared input, sent with every message (repeatable)',
    collectInput,
    {} as Record<string, string>,
  )
  .action(async (agentId: string, opts: ChatOptions) => {
    const config = loadConfig();
    const stores = openStores();
    const sessions = SessionStore.fromHandle(stores.db);
    const { deps, close } = openV2Deps(config, stores);
    try {
      const agent = stores.agents.getAgent(agentId);
      if (!agent) {
        ui.fail(`Agent "${agentId}" not found.`);
        process.exitCode = 1;
        return;
      }

      if (opts.list) {
        const list = sessions.list(agent.id);
        ui.section(`Conversations — ${agent.id}`);
        if (list.length === 0) console.log(ui.dim('  None yet. Start one with: sua agent chat ' + agent.id));
        for (const s of list) {
          const n = sessions.turns(s.id).length;
          console.log(`  ${chalk.bold(s.id)}  ${s.title}  ${ui.dim(`${n} turn${n === 1 ? '' : 's'} · ${s.updatedAt}`)}`);
        }
        return;
      }

      if (opts.session) {
        const s = sessions.get(opts.session);
        if (!s || s.agentId !== agent.id) throw new SessionNotFoundError(opts.session, agent.id);
      }

      if (opts.show) {
        if (!opts.session) {
          ui.fail('--show needs --session <id>.');
          process.exitCode = 2;
          return;
        }
        for (const t of reconcileSession(sessions, stores.runs, opts.session)) printTurn(t);
        return;
      }

      // Fail before prompting if the agent can't take a message.
      resolveChatInput(agent);

      if (opts.message !== undefined) {
        const { sessionId, ok } = await oneTurn(agent, sessions, deps, opts.message, opts.session, opts.input);
        console.log(ui.dim(`session ${sessionId} — continue with: sua agent chat ${agent.id} --session ${sessionId}`));
        if (!ok) process.exitCode = 1;
        return;
      }

      let sessionId = opts.session;
      if (sessionId) {
        for (const t of reconcileSession(sessions, stores.runs, sessionId)) printTurn(t);
      }
      console.log(ui.dim(`Talking to ${agent.id}. Empty line or Ctrl-D to stop.`));
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        for (;;) {
          let line: string;
          try { line = await rl.question(chalk.bold('you  ')); } catch { break; }
          if (!line.trim()) break;
          ({ sessionId } = await oneTurn(agent, sessions, deps, line, sessionId, opts.input));
        }
      } finally {
        rl.close();
      }
      if (sessionId) console.log(ui.dim(`session ${sessionId} — continue with: sua agent chat ${agent.id} --session ${sessionId}`));
    } catch (err) {
      if (err instanceof NotConversationalError || err instanceof SessionNotFoundError || err instanceof ChatMessageError) {
        ui.fail(err.message);
        process.exitCode = 1;
        return;
      }
      throw err;
    } finally {
      close();
      stores.close();
    }
  });
