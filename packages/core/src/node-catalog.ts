/**
 * Node catalog — typed contract for each first-class node type.
 *
 * Used by the planner-fronted agent-builder (PR A) to discover what
 * primitives are available, and by the dashboard's `/nodes` page for
 * human browsing. Hand-authored, not derived: source of truth lives in
 * `agent-v2-types.ts` (the type enum + per-config interfaces) and the
 * executor; this file is a friendly summary of those for both LLMs and
 * humans.
 *
 * Adding a new node type: append the type to `NodeType` in
 * `agent-v2-types.ts`, then add an entry here. The test in
 * `node-catalog.test.ts` will fail until every NodeType has an entry,
 * which is the intended forcing function.
 */

import type { NodeType } from './agent-v2-types.js';

export interface NodeContract {
  /** The node type literal (matches `NodeType`). */
  type: NodeType;
  /** One-sentence description for browsing. */
  description: string;
  /**
   * Fields a YAML author sets on the node. Each entry says what the
   * field does and whether it's required.
   */
  inputs: NodeContractField[];
  /**
   * Fields downstream nodes can read from this node's `result`. Use
   * this to know what to put after `upstream.<id>.` in templates.
   */
  outputs: NodeContractField[];
  /** When this node type is the right choice. 2–5 bullets. */
  use_when: string[];
  /** Minimal working YAML — copy-pasteable. */
  example: string;
}

export interface NodeContractField {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

export const NODE_CATALOG: Record<NodeType, NodeContract> = {
  shell: {
    type: 'shell',
    description: 'Run a shell command. Captures stdout, stderr, and exit code.',
    inputs: [
      { name: 'command', type: 'string', required: true, description: 'Bash command to run. Reference inputs as $NAME (env vars), upstream outputs as $UPSTREAM_<ID>_RESULT.' },
      { name: 'tool', type: 'string', description: 'Optional named tool (e.g. http-get, file-read, file-write). When set, `toolInputs:` provides the tool args and `command:` is unused.' },
      { name: 'toolInputs', type: 'object', description: 'Tool-specific input map when `tool:` is set.' },
      { name: 'timeout', type: 'number', description: 'Seconds before the command is killed. Default 300.' },
      { name: 'env', type: 'object', description: 'Extra env vars merged into the shell environment. Values may template {{inputs.X}}.' },
      { name: 'envAllowlist', type: 'string[]', description: 'Restricts inherited env vars to this list (defense against secret leakage).' },
      { name: 'secrets', type: 'string[]', description: 'Secret names (UPPERCASE_WITH_UNDERSCORES) to inject from the secrets store as env vars.' },
      { name: 'redactSecrets', type: 'boolean', description: 'When true, scrub known-prefix tokens (AWS, GitHub, OpenAI, Slack) from captured output before storage.' },
      { name: 'workingDirectory', type: 'string', description: 'Run the command in this directory (relative to repo root).' },
      { name: 'dependsOn', type: 'string[]', description: 'Upstream node ids this node waits on.' },
      { name: 'onlyIf', type: 'OnlyIfCondition', description: 'Per-edge predicate; node is skipped (not failed) when the predicate is false.' },
    ],
    outputs: [
      { name: 'result', type: 'string', description: 'Captured stdout. Trailing newline stripped.' },
      { name: 'stderr', type: 'string', description: 'Captured stderr.' },
      { name: 'exit_code', type: 'number', description: '0 on success.' },
    ],
    use_when: [
      'You need to run an existing CLI tool (curl, jq, gh, etc.).',
      'The data manipulation fits in one bash pipeline.',
      'You want a deterministic, no-LLM step.',
      'A built-in tool (http-get, file-read, file-write) covers your need — set `tool:` instead of writing the curl/cat by hand.',
    ],
    example: `- id: fetch
  type: shell
  command: curl -sf "https://news.ycombinator.com/" | jq .data
  timeout: 30`,
  },

  'claude-code': {
    type: 'claude-code',
    description: 'Run an LLM (Claude or Codex) with a prompt. Optional tool access via allowedTools.',
    inputs: [
      { name: 'prompt', type: 'string', required: true, description: 'Prompt text. References inputs via {{inputs.X}}, upstreams via {{upstream.<id>.result}}.' },
      { name: 'provider', type: "'claude' | 'codex'", description: 'Which CLI to spawn. Defaults to the agent-level provider, then to claude.' },
      { name: 'model', type: 'string', description: 'Override the default model for this node only.' },
      { name: 'maxTurns', type: 'number', description: 'Cap on tool-use turns. Default 5.' },
      { name: 'allowedTools', type: 'string[]', description: 'Tools the LLM may call. Built-ins: file-read, file-write, Edit, Write, web-search, etc. MCP tools when configured.' },
      { name: 'timeout', type: 'number', description: 'Seconds before the LLM call is killed. Default 300.' },
      { name: 'env', type: 'object', description: 'Extra env vars (rarely needed for claude-code).' },
      { name: 'secrets', type: 'string[]', description: 'Secret names injected as env vars (visible to allowed shell commands the LLM runs).' },
      { name: 'dependsOn', type: 'string[]', description: 'Upstream node ids this node waits on.' },
      { name: 'onlyIf', type: 'OnlyIfCondition', description: 'Per-edge predicate.' },
    ],
    outputs: [
      { name: 'result', type: 'string', description: "The LLM's final assistant message. Plain text unless you ask for JSON in the prompt." },
    ],
    use_when: [
      'You need free-form analysis, summarization, classification, or generation.',
      'The output shape is hard to specify with jq/regex (e.g. extracting structured data from messy HTML).',
      'You want the LLM to make decisions inside the DAG (route, score, draft).',
      "Don't reach for it for deterministic data shaping — shell + jq is faster, cheaper, and reproducible.",
    ],
    example: `- id: summarise
  type: claude-code
  prompt: |
    Summarise this in 3 bullets:
    {{upstream.fetch.result}}
  maxTurns: 1
  timeout: 60`,
  },

  conditional: {
    type: 'conditional',
    description: 'Evaluate a predicate against an upstream output. Emits `matched: true | false` for downstream nodes to branch on via onlyIf.',
    inputs: [
      { name: 'conditionalConfig.predicate', type: 'OnlyIfCondition', description: 'The predicate to evaluate. Same shape as onlyIf: { field, equals/notEquals/contains/greaterThan/lessThan }.' },
      { name: 'dependsOn', type: 'string[]', required: true, description: 'Exactly one upstream — the data source the predicate reads.' },
    ],
    outputs: [
      { name: 'matched', type: 'boolean', description: 'true when the predicate holds against the upstream output.' },
    ],
    use_when: [
      'You want a clearly-named branch point in the DAG visualization.',
      'Multiple downstream nodes share the same gate — checking once is cheaper than re-evaluating in every onlyIf.',
      'For a one-shot gate to a single downstream, putting onlyIf directly on the downstream is simpler.',
    ],
    example: `- id: check-status
  type: conditional
  dependsOn: [fetch]
  conditionalConfig:
    predicate: { field: status_code, equals: 200 }`,
  },

  switch: {
    type: 'switch',
    description: 'Multi-way branch. Reads a string field from an upstream and emits `selected_case`; downstream nodes filter via onlyIf.',
    inputs: [
      { name: 'switchConfig.field', type: 'string', required: true, description: 'Field name in the upstream output (JSON key).' },
      { name: 'switchConfig.cases', type: 'string[]', required: true, description: 'Allowed case values.' },
      { name: 'switchConfig.defaultCase', type: 'string', description: 'Used when the upstream field matches no listed case.' },
      { name: 'dependsOn', type: 'string[]', required: true, description: 'Exactly one upstream.' },
    ],
    outputs: [
      { name: 'selected_case', type: 'string', description: 'The case that matched (or defaultCase).' },
    ],
    use_when: [
      'You have 3+ exclusive downstream paths (low/medium/high, type-A/B/C).',
      'A chain of conditional nodes would be noisier than one switch.',
      "Don't reach for it with only 2 cases — a single conditional is shorter.",
    ],
    example: `- id: classify
  type: switch
  dependsOn: [analyze]
  switchConfig:
    field: severity
    cases: [low, medium, high]
    defaultCase: low`,
  },

  loop: {
    type: 'loop',
    description: 'Iterate a sub-agent over a list. Emits a JSON array of the sub-agent results.',
    inputs: [
      { name: 'loopConfig.over', type: 'string', required: true, description: 'Field name in the upstream output (must resolve to an array).' },
      { name: 'loopConfig.agentId', type: 'string', required: true, description: 'Id of the sub-agent to invoke per item.' },
      { name: 'loopConfig.maxIterations', type: 'number', description: 'Safety cap. Default 10.' },
      { name: 'loopConfig.inputMapping', type: 'object', description: 'Map sub-agent inputs to per-iteration values. Use $item.<field> to reference fields on the current item.' },
      { name: 'dependsOn', type: 'string[]', required: true, description: 'Exactly one upstream — the source of the array.' },
    ],
    outputs: [
      { name: 'result', type: 'array', description: 'Array of the sub-agent results, in iteration order.' },
    ],
    use_when: [
      'You have a list and need to do the same multi-step thing to each item.',
      "The work doesn't fit cleanly in a single shell pipeline (otherwise just use jq + a bash for-loop).",
      'You want per-iteration runs visible in the dashboard for debugging.',
    ],
    example: `- id: research-each
  type: loop
  dependsOn: [topics]
  loopConfig:
    over: topics
    agentId: two-step-digest
    maxIterations: 10
    inputMapping:
      TOPIC: "$item.title"`,
  },

  'agent-invoke': {
    type: 'agent-invoke',
    description: 'Call another agent as a single sub-workflow. The sub-agent`s final result becomes this node`s result.',
    inputs: [
      { name: 'agentInvokeConfig.agentId', type: 'string', required: true, description: 'Id of the sub-agent to invoke.' },
      { name: 'agentInvokeConfig.inputMapping', type: 'object', description: 'Map sub-agent inputs from this agent`s scope. Use $upstream.<id>.<field> or {{inputs.X}}.' },
      { name: 'dependsOn', type: 'string[]', description: 'Upstream node ids this node waits on.' },
      { name: 'onlyIf', type: 'OnlyIfCondition', description: 'Per-edge predicate.' },
    ],
    outputs: [
      { name: 'result', type: 'string | object', description: 'The sub-agent`s final result, passed through.' },
      { name: 'invoked_run_id', type: 'string', description: 'Run id of the sub-agent`s execution. Useful for follow-up inspection.' },
    ],
    use_when: [
      'You`ve built a reusable pipeline you want to compose into multiple parents.',
      'Cross-agent composition keeps each agent`s scope focused.',
      "Don't use it just to organize a long DAG — split into multiple agents only when reuse exists.",
    ],
    example: `- id: analyze
  type: agent-invoke
  dependsOn: [fetch]
  agentInvokeConfig:
    agentId: agent-analyzer
    inputMapping:
      AGENT_YAML: "$upstream.fetch.result"`,
  },

  branch: {
    type: 'branch',
    description: 'Explicit fork point. Runs no logic; splits one upstream into multiple downstream paths for visual clarity.',
    inputs: [
      { name: 'dependsOn', type: 'string[]', required: true, description: 'Exactly one upstream — the source being forked.' },
    ],
    outputs: [
      { name: 'result', type: 'unchanged', description: 'Pass-through of the upstream`s result.' },
    ],
    use_when: [
      'You want the DAG visualization to clearly show "fan-out from here."',
      'Several independent follow-on chains all read from the same source.',
      "If the downstream nodes can just declare dependsOn directly on the source, branch is redundant.",
    ],
    example: `- id: fan-out
  type: branch
  dependsOn: [fetch]`,
  },

  end: {
    type: 'end',
    description: 'Terminal node. Marks a path complete; downstream-of-end paths are skipped and the run finishes as soon as everything else is done.',
    inputs: [
      { name: 'endMessage', type: 'string', description: 'Human-readable reason this end fired. Surfaced in the run detail.' },
      { name: 'dependsOn', type: 'string[]', description: 'Upstreams that must complete before this end fires.' },
      { name: 'onlyIf', type: 'OnlyIfCondition', description: 'Conditional end — only fires when the predicate holds.' },
    ],
    outputs: [],
    use_when: [
      'You want to stop a path early when a success criterion is met (e.g. "we found what we needed; skip the fallback").',
      'Inside a `loop`, prefer `break` (which is end-scoped to the loop).',
    ],
    example: `- id: short-circuit
  type: end
  dependsOn: [check]
  onlyIf: { upstream: check, field: matched, equals: true }
  endMessage: "Already up to date — nothing to do."`,
  },

  break: {
    type: 'break',
    description: 'Loop-scoped end. Halts the enclosing loop early when the predicate fires.',
    inputs: [
      { name: 'dependsOn', type: 'string[]', required: true, description: 'Usually the loop node itself or a downstream of it.' },
      { name: 'onlyIf', type: 'OnlyIfCondition', description: 'Predicate that triggers the break.' },
    ],
    outputs: [],
    use_when: [
      'A loop should stop as soon as one iteration succeeds (early-exit search).',
      'A loop should stop when an external condition is met mid-iteration.',
      'For non-loop early-exit, use `end` instead.',
    ],
    example: `- id: stop-on-first-success
  type: break
  dependsOn: [try-fetch-loop]
  onlyIf: { upstream: try-fetch-loop, field: any_matched, equals: true }`,
  },
};

/**
 * Helper for routes/tests: get every node type as an array, sorted
 * alphabetically by type for stable output.
 */
export function listNodeContracts(): NodeContract[] {
  return Object.values(NODE_CATALOG).slice().sort((a, b) => a.type.localeCompare(b.type));
}

export function getNodeContract(type: string): NodeContract | undefined {
  return (NODE_CATALOG as Record<string, NodeContract>)[type];
}
