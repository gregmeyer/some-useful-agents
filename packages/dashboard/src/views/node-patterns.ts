/**
 * Curated node patterns for the add-node catalog. Each pattern pre-fills
 * the form with sensible defaults for a common node shape. Extensible
 * later via user-defined patterns stored in the DB.
 */
export interface NodePattern {
  id: string;
  name: string;
  description: string;
  /** Tool id to select in the dropdown. */
  tool: string;
  /** Default values for toolInput_* fields. */
  defaults: Record<string, string>;
}

export const NODE_PATTERNS: NodePattern[] = [
  {
    id: 'fetch-url',
    name: 'Fetch URL',
    description: 'HTTP GET a URL and pass the JSON response downstream.',
    tool: 'http-get',
    defaults: { url: '', timeout: '30' },
  },
  {
    id: 'analyze-with-llm',
    name: 'Analyze with LLM',
    description: 'Send upstream output to Claude for analysis or summarization.',
    tool: 'claude-code',
    defaults: { prompt: 'Analyze this data and summarize the key findings:\n{{upstream.CHANGE_ME.result}}', maxTurns: '1' },
  },
  {
    id: 'shell-transform',
    name: 'Shell transform',
    description: 'Process data with jq, awk, sed, or other CLI tools.',
    tool: 'shell-exec',
    defaults: { command: 'echo "$UPSTREAM_CHANGE_ME_RESULT" | jq .' },
  },
  {
    id: 'write-output',
    name: 'Write to file',
    description: 'Save results to a file on disk.',
    tool: 'file-write',
    defaults: { path: 'output.json', content: '' },
  },
  {
    id: 'post-webhook',
    name: 'POST to webhook',
    description: 'Send JSON to an HTTP endpoint (Slack, Discord, API, etc.).',
    tool: 'http-post',
    defaults: { url: '', body: '{}', timeout: '30' },
  },
];
