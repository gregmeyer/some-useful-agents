import { existsSync } from 'node:fs';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  evaluatePolicy,
  loadPolicyDocument,
  policyFilePath,
  PolicyLoadError,
  type PolicyDocument,
} from '@some-useful-agents/core';
import { loadConfig, getDataRoot } from '../config.js';
import * as ui from '../ui.js';

/**
 * `sua policy` — read and test the tool policy (`<dataDir>/.sua/policies.json`).
 * Editing stays in the file for now; these verbs answer "what's enforced?",
 * "would this call be allowed?", and "is the file valid?" before a run finds
 * out the hard way. See docs/tool-policies.md.
 */
export const policyCommand = new Command('policy')
  .description('Show, test, and validate the tool policy (.sua/policies.json)');

const SOURCES = ['examples', 'local', 'community'] as const;

function load(): { path: string; exists: boolean; doc?: PolicyDocument; error?: string } {
  const dataDir = getDataRoot(loadConfig());
  const path = policyFilePath(dataDir);
  const exists = existsSync(path);
  try {
    return { path, exists, doc: loadPolicyDocument(dataDir) };
  } catch (err) {
    return { path, exists, error: err instanceof PolicyLoadError ? err.message : String(err) };
  }
}

policyCommand
  .command('show')
  .description('Print the policy in force: default action and numbered rules')
  .action(() => {
    const { path, exists, doc, error } = load();
    ui.section('Tool policy');
    console.log(`  ${ui.dim('file')}  ${path}${exists ? '' : ui.dim('  (not present — everything is allowed)')}`);
    if (error) {
      ui.fail(error);
      console.log(ui.dim('  While the file is invalid, every tool call is BLOCKED (fail closed).'));
      process.exitCode = 1;
      return;
    }
    const d = doc!;
    console.log(`  ${ui.dim('default')} ${d.defaultAction === 'deny' ? chalk.red('deny') : chalk.green('allow')}`);
    if (d.rules.length === 0) {
      console.log(ui.dim('  no rules'));
      return;
    }
    console.log(ui.dim('  rules (the LAST one that matches decides):'));
    d.rules.forEach((r, i) => {
      const effect = r.effect === 'deny' ? chalk.red('deny ') : chalk.green('allow');
      const resources = r.resources.length ? r.resources.join(', ') : 'any resource';
      const source = r.conditions?.source ? ui.dim(` [source: ${r.conditions.source.join(', ')}]`) : '';
      console.log(`  #${i}  ${effect} ${chalk.bold(r.tool)} on ${resources}${source}${r.reason ? ui.dim(` — ${r.reason}`) : ''}`);
    });
  });

policyCommand
  .command('check')
  .description('Would this tool call be allowed? e.g. sua policy check web-fetch https://example.com/x')
  .argument('<tool>', 'Tool id (web-fetch, http-post, file-write, shell-exec, an MCP tool id, …)')
  .argument('[resource]', 'URL, absolute file path, or command the call would touch')
  .option('--source <source>', `Agent source tier: ${SOURCES.join(' | ')}`, 'local')
  .option('--agent <id>', 'Agent id (for the record)', 'cli-check')
  .action((tool: string, resource: string | undefined, opts: { source: string; agent: string }) => {
    if (!(SOURCES as readonly string[]).includes(opts.source)) {
      ui.fail(`--source must be one of ${SOURCES.join(', ')}`);
      process.exitCode = 2;
      return;
    }
    const { doc, error } = load();
    const decision = error
      ? evaluatePolicy({ version: 1, defaultAction: 'deny', rules: [], invalidReason: `${error} — every tool call is blocked until it's fixed.` }, { toolId: tool, resource: resource ?? '', agentSource: opts.source as typeof SOURCES[number], agentId: opts.agent })
      : evaluatePolicy(doc!, { toolId: tool, resource: resource ?? '', agentSource: opts.source as typeof SOURCES[number], agentId: opts.agent });
    const by = decision.matchedRuleIndex !== undefined && decision.matchedRuleIndex >= 0
      ? `rule #${decision.matchedRuleIndex}`
      : error ? 'invalid policy file' : 'default action';
    if (decision.effect === 'allow') ui.ok(`allow  (${by})`);
    else ui.fail(`deny   (${by})${decision.reason ? ` — ${decision.reason}` : ''}`);
    // Exit code doubles as the answer for scripts: 0 allow, 1 deny.
    process.exitCode = decision.effect === 'allow' ? 0 : 1;
  });

policyCommand
  .command('validate')
  .description('Exit non-zero if the policy file is invalid (for CI / pre-commit)')
  .action(() => {
    const { path, exists, doc, error } = load();
    if (error) {
      ui.fail(error);
      process.exitCode = 1;
      return;
    }
    ui.ok(exists ? `${path} is valid (${doc!.rules.length} rule${doc!.rules.length === 1 ? '' : 's'}, default ${doc!.defaultAction}).` : `No policy file at ${path} (everything is allowed).`);
  });
