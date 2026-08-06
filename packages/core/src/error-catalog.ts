/**
 * The error reference catalog: for every failure the executor can emit — each
 * `NodeErrorCategory` and each common shell exit code — what it means, why it
 * usually happens, and how to fix it.
 *
 * This is the single source of truth. It powers two surfaces:
 *   1. Auto-attach — `run-failure-inbox` folds `lookupErrorHelp()` into the
 *      inbox thread of every failed run (deterministic, no LLM, no setup).
 *   2. The `error-troubleshooter` example agent — a generator serialises this
 *      catalog into `agents/examples/data/error-reference.db`, which the agent
 *      queries via the read-only `sqlite.error-reference.errors.find` tool.
 *
 * The terse one-line `label` comes from `failure-explain.ts` so the wording
 * stays consistent with `explainNodeFailure`; this module adds the longer
 * `meaning`, `commonCauses`, and `troubleshooting` an operator needs to act.
 */

import { EXIT_CODE_LABELS, ERROR_CATEGORY_LABELS, formatErrorCategory } from './failure-explain.js';

export type ErrorCatalogKind = 'category' | 'exit_code';

export interface ErrorCatalogEntry {
  /** `category` for a NodeErrorCategory, `exit_code` for a shell exit code. */
  kind: ErrorCatalogKind;
  /** The lookup key: the category name (`exit_nonzero`) or the code as a string (`127`). */
  key: string;
  /** Terse one-line label — reused from failure-explain for consistency. */
  label: string;
  /** A sentence or two explaining what actually happened. */
  meaning: string;
  /** The usual reasons this fires, most common first. */
  commonCauses: string[];
  /** Concrete, ordered steps to diagnose and fix it. */
  troubleshooting: string[];
}

/** Troubleshooting content per NodeErrorCategory. label is filled from the shared map. */
const CATEGORY_HELP: Record<string, Omit<ErrorCatalogEntry, 'kind' | 'label'>> = {
  setup: {
    key: 'setup',
    meaning: 'The node failed before it could run — resolving its configuration (secrets, required inputs, tool wiring) did not succeed, so no process ever started.',
    commonCauses: [
      'A required input was not provided and has no default.',
      'A secret the node declares is missing from the secrets store, or the store is locked.',
      'The node references a tool or integration that is not configured.',
    ],
    troubleshooting: [
      'Read the node error text — it names the specific missing input, secret, or tool.',
      'For a missing secret: add it under Settings → Secrets and declare it in the node\'s `secrets:` list.',
      'For a missing input: pass it at run time, or give the input a `default` in the agent YAML.',
      'For a missing tool/integration: configure it under Settings → Integrations, then re-run.',
    ],
  },
  input_resolution: {
    key: 'input_resolution',
    meaning: 'A template placeholder in the node could not be filled in — usually an upstream node produced no output where this node expected one.',
    commonCauses: [
      'An upstream node returned empty output that this node interpolates with `{{upstream.<id>.result}}`.',
      'A referenced upstream id is misspelled or missing from `dependsOn`.',
      'An `{{inputs.X}}` / `{{vars.X}}` reference points at a name that does not exist.',
    ],
    troubleshooting: [
      'Open the run page and check the referenced upstream node actually produced output.',
      'Confirm the upstream node id in the template matches a node listed in this node\'s `dependsOn`.',
      'Verify the input/variable name exists (Settings → Variables, or the agent\'s `inputs:` block).',
    ],
  },
  spawn_failure: {
    key: 'spawn_failure',
    meaning: 'The operating system could not start the process at all — the executable was not found or could not be launched (this is distinct from a program that ran and then exited non-zero).',
    commonCauses: [
      'The command/binary is not installed on the machine.',
      'The binary exists but its directory is not on the node\'s `$PATH`.',
      'The file is present but not marked executable.',
    ],
    troubleshooting: [
      'Run `which <command>` in a terminal — nothing printed means it is not on `$PATH`.',
      'Install the tool, or reference it by absolute path in the node command.',
      'If installed via nvm/pyenv/asdf/a virtualenv, ensure that environment is active for the node.',
      'Check the execute bit with `ls -l <path>`; `chmod +x <path>` if missing.',
    ],
  },
  exit_nonzero: {
    key: 'exit_nonzero',
    meaning: 'The command ran to completion but returned a non-zero exit code, which by convention signals failure. The specific code narrows down why — see the matching exit-code entry.',
    commonCauses: [
      'The program hit an error and reported it via its exit status (see stderr).',
      'A missing argument, bad flag, or malformed input the program rejected.',
      'An upstream dependency (network, file, credential) the command needs was unavailable.',
    ],
    troubleshooting: [
      'Read the stderr tail on the run page — it usually names the exact failure.',
      'Look up the specific exit code (e.g. 127 = command not found, 126 = permission denied).',
      'Reproduce the command locally with the same inputs to see the full error.',
    ],
  },
  timeout: {
    key: 'timeout',
    meaning: 'The node exceeded its time budget and was killed. The work may have been slow, stuck, or waiting on something that never arrived.',
    commonCauses: [
      'The command genuinely needs longer than the configured `timeoutSec`.',
      'It blocked waiting on network, a prompt, or a lock that never resolved.',
      'An LLM/provider call hung.',
    ],
    troubleshooting: [
      'Raise the node/agent `timeoutSec` if the work is legitimately slow.',
      'Ensure the command never waits for interactive input (it runs non-interactively).',
      'Add retries for flaky network steps (`retry.categories: [timeout]`).',
    ],
  },
  cancelled: {
    key: 'cancelled',
    meaning: 'The run was deliberately cancelled — by an operator, or by the provider shutting down. Not an error in the agent itself.',
    commonCauses: [
      'Someone cancelled the run from the dashboard or CLI.',
      'The worker/provider was shut down or restarted while the run was in flight.',
    ],
    troubleshooting: [
      'If unexpected, check whether the worker or dashboard was restarted at that time.',
      'Simply re-run the agent — cancellation leaves no bad state.',
    ],
  },
  abandoned: {
    key: 'abandoned',
    meaning: 'The run was in flight when the dashboard restarted or crashed. The child process was orphaned and its in-memory state died with the parent; the run is reaped on the next boot.',
    commonCauses: [
      'The dashboard process restarted (deploy, crash, manual restart) mid-run.',
      'The machine slept or lost power while a run was executing.',
    ],
    troubleshooting: [
      'Re-run the agent — abandoned runs are infrastructure churn, not agent bugs.',
      'If frequent, check for a crashing/looping dashboard process or an unstable host.',
    ],
  },
  upstream_failed: {
    key: 'upstream_failed',
    meaning: 'This node never ran because a node it depends on failed first. It was skipped so the failure has a single root cause.',
    commonCauses: [
      'An upstream node in `dependsOn` failed for its own reason.',
    ],
    troubleshooting: [
      'Find the named upstream node on the run page and fix ITS failure — this node clears once the root cause is resolved.',
      'Then re-run (or replay from the failed upstream node).',
    ],
  },
  condition_not_met: {
    key: 'condition_not_met',
    meaning: 'A control-flow condition routed execution away from this node, so it was skipped. Usually expected behaviour, not an error.',
    commonCauses: [
      'A branch/condition node evaluated such that this path was not taken.',
    ],
    troubleshooting: [
      'Confirm the branch condition is what you intended for these inputs.',
      'Inspect the deciding condition node\'s output on the run page.',
    ],
  },
  flow_ended: {
    key: 'flow_ended',
    meaning: 'The flow reached an explicit end before this node, so it did not run. Typically intentional.',
    commonCauses: [
      'An end/stop control-flow node terminated the run earlier.',
    ],
    troubleshooting: [
      'Verify the flow was meant to end where it did for this input.',
    ],
  },
  invalid_output: {
    key: 'invalid_output',
    meaning: 'An llm-prompt node exited cleanly but its output did not satisfy the node\'s declared output contract (e.g. a required block or field was missing).',
    commonCauses: [
      'A weaker fallback model returned output missing the required structure.',
      'The prompt did not constrain the model tightly enough to meet the contract.',
    ],
    troubleshooting: [
      'Inspect the node output on the run page against the declared `outputContract`.',
      'Tighten the prompt, or allow a stronger provider in the waterfall.',
      'Loosen the contract if the requirement is stricter than necessary.',
    ],
  },
  policy_denied: {
    key: 'policy_denied',
    meaning: 'A tool policy blocked this node from acting on a resource the project policy forbids. A deliberate guardrail, not a transient error.',
    commonCauses: [
      'The node tried a tool/host/resource the active tool policy denies.',
    ],
    troubleshooting: [
      'Review the project tool policy for the resource the node targeted.',
      'Either adjust the policy to permit it, or change the node to stay within policy.',
    ],
  },
};

/** Troubleshooting content per common shell exit code. */
const EXIT_CODE_HELP: Record<string, Omit<ErrorCatalogEntry, 'kind' | 'label'>> = {
  '1': {
    key: '1',
    meaning: 'A general, unspecified error — the catch-all non-zero code many programs use when something went wrong without a more specific code.',
    commonCauses: ['The program reported a runtime error via stderr.', 'A failed assertion, unhandled case, or bad input.'],
    troubleshooting: ['Read the stderr tail — the program almost always explains itself there.', 'Reproduce locally with the same inputs.'],
  },
  '2': {
    key: '2',
    meaning: 'Misuse of a shell builtin — usually a syntax error in the command or an invalid option.',
    commonCauses: ['A shell syntax error (unbalanced quotes, bad redirection).', 'An invalid flag passed to a builtin.'],
    troubleshooting: ['Check the command for quoting/syntax mistakes.', 'Run the command by hand to see the shell\'s parse error.'],
  },
  '126': {
    key: '126',
    meaning: 'The command was found but could not be executed — typically a permissions problem or a non-executable target.',
    commonCauses: ['The file lacks the execute bit.', 'A permission/ownership problem on the file or its directory.', 'Trying to execute a directory or a data file.'],
    troubleshooting: ['`ls -l <path>` to check permissions; `chmod +x <path>` if the execute bit is missing.', 'Confirm the target is actually an executable, not a directory or text file.'],
  },
  '127': {
    key: '127',
    meaning: 'Command not found — the shell searched every directory on $PATH and found no executable by that name.',
    commonCauses: ['A typo in the command name.', 'The tool is not installed.', 'The binary exists but its directory is not on the node\'s $PATH (common on macOS when /opt/homebrew/bin is missing).', 'The tool lives in an nvm/pyenv/virtualenv that is not active.'],
    troubleshooting: ['`which <command>` — nothing printed confirms it is not on $PATH.', 'Fix the typo, or install the tool.', 'If installed, reference it by absolute path or add its directory to the node\'s environment.', 'Activate the right nvm/pyenv/virtualenv for the node.'],
  },
  '128': {
    key: '128',
    meaning: 'Invalid argument to `exit` — the program called exit with a value outside 0–255.',
    commonCauses: ['A script did `exit <non-numeric>` or an out-of-range value.'],
    troubleshooting: ['Find the `exit` call in the script and pass a valid 0–255 status.'],
  },
  '130': {
    key: '130',
    meaning: 'Terminated by Ctrl+C (SIGINT, 128 + signal 2). The process was interrupted.',
    commonCauses: ['A manual interrupt.', 'A parent process forwarded an interrupt.'],
    troubleshooting: ['If unexpected, check what sent the interrupt (a wrapping timeout or supervisor).'],
  },
  '137': {
    key: '137',
    meaning: 'Killed by SIGKILL (128 + signal 9) — most often the out-of-memory killer terminating the process.',
    commonCauses: ['The process exceeded available memory and the OOM killer stopped it.', 'Something sent an explicit `kill -9`.', 'A container memory limit was hit.'],
    troubleshooting: ['Reduce the command\'s memory use, or run it on a host with more memory.', 'Check `dmesg` / system logs for an OOM-killer entry around that time.', 'Raise the container/cgroup memory limit if one applies.'],
  },
  '139': {
    key: '139',
    meaning: 'Segmentation fault (128 + signal 11) — the program crashed accessing invalid memory.',
    commonCauses: ['A bug in the invoked binary or one of its native libraries.', 'A corrupt or ABI-incompatible dependency.'],
    troubleshooting: ['Update or reinstall the offending binary/library.', 'Try a different version of the tool; report the crash upstream if it persists.'],
  },
  '143': {
    key: '143',
    meaning: 'Terminated by SIGTERM (128 + signal 15) — the process was asked to shut down gracefully.',
    commonCauses: ['A timeout or supervisor sent SIGTERM.', 'The host began shutting down.'],
    troubleshooting: ['Check for a wrapping timeout or a process manager that terminated it.', 'If it needs longer, raise the timeout.'],
  },
  '3': {
    key: '3',
    meaning: 'A command-specific error. For curl this is a malformed URL; other tools assign their own meaning to code 3.',
    commonCauses: ['curl: the URL was malformed.', 'For other tools: consult that tool\'s exit-code documentation.'],
    troubleshooting: ['If using curl, check the URL is well-formed and fully quoted.', 'Otherwise look up what code 3 means for the specific command.'],
  },
  '6': {
    key: '6',
    meaning: 'curl could not resolve the host — DNS lookup failed.',
    commonCauses: ['A typo in the hostname.', 'No network/DNS available.', 'The host does not exist.'],
    troubleshooting: ['Verify the hostname; try `nslookup <host>`.', 'Confirm the machine has working DNS/network.'],
  },
  '7': {
    key: '7',
    meaning: 'curl failed to connect to the host — DNS resolved but the connection was refused or unreachable.',
    commonCauses: ['The service is down or not listening on that port.', 'A firewall blocked the connection.', 'Wrong port.'],
    troubleshooting: ['Confirm the service is up and the port is correct.', 'Check firewall/network reachability to the host.'],
  },
  '22': {
    key: '22',
    meaning: 'curl received an HTTP error (with `-f/--fail`, a 4xx/5xx response makes curl exit 22).',
    commonCauses: ['The server returned 4xx (bad request/auth) or 5xx (server error).', 'A missing/incorrect API key or endpoint.'],
    troubleshooting: ['Re-run without `-f` (or add `-i`) to see the status code and body.', 'For 4xx, check auth headers, the URL, and the request payload.', 'For 5xx, the remote service is failing — retry or check its status.'],
  },
  '28': {
    key: '28',
    meaning: 'curl timed out — an operation exceeded its allotted time.',
    commonCauses: ['The remote host is slow or unreachable.', 'A `--max-time`/`--connect-timeout` set too low.'],
    troubleshooting: ['Raise curl\'s timeout, or add retries.', 'Check whether the remote endpoint is healthy and reachable.'],
  },
};

/**
 * The full catalog as a flat array — categories first, then exit codes. Each
 * `label` is pulled from the shared failure-explain maps so it stays identical
 * to what `explainNodeFailure` renders.
 */
export const ERROR_CATALOG: ErrorCatalogEntry[] = [
  ...Object.values(CATEGORY_HELP).map((e): ErrorCatalogEntry => ({
    kind: 'category',
    label: formatErrorCategory(e.key),
    ...e,
  })),
  ...Object.values(EXIT_CODE_HELP).map((e): ErrorCatalogEntry => ({
    kind: 'exit_code',
    label: EXIT_CODE_LABELS[Number(e.key)] ?? `exit ${e.key}`,
    ...e,
  })),
];

/**
 * Look up the most specific help for a failure. A shell `exit_nonzero` with a
 * known exit code resolves to that code's entry (more actionable than the
 * generic category); otherwise the category entry is returned. Returns
 * undefined when nothing in the catalog matches.
 */
export function lookupErrorHelp(f: { category?: string; exitCode?: number | null }): ErrorCatalogEntry | undefined {
  if (f.exitCode != null) {
    const byCode = EXIT_CODE_HELP[String(f.exitCode)];
    if (byCode) return { kind: 'exit_code', label: EXIT_CODE_LABELS[f.exitCode] ?? `exit ${f.exitCode}`, ...byCode };
  }
  if (f.category) {
    const byCat = CATEGORY_HELP[f.category];
    if (byCat) return { kind: 'category', label: formatErrorCategory(f.category), ...byCat };
  }
  return undefined;
}

/**
 * Render a catalog entry as a compact Markdown "Troubleshooting" block for the
 * inbox thread. Kept short — meaning + top causes + fix steps — so it informs
 * without burying the rest of the failure note.
 */
export function renderTroubleshootingMarkdown(entry: ErrorCatalogEntry): string {
  const causes = entry.commonCauses.slice(0, 3).map((c) => `  - ${c}`).join('\n');
  const steps = entry.troubleshooting.slice(0, 4).map((s, i) => `  ${i + 1}. ${s}`).join('\n');
  return [
    `**What this means:** ${entry.meaning}`,
    '',
    'Likely causes:',
    causes,
    '',
    'Try:',
    steps,
  ].join('\n');
}
