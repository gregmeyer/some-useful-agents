/**
 * Ideas for a tool to make, for Tools → New tool → Describe it (docs/tools.md).
 * A tool is worth having where your agents keep rewriting the same thing, so
 * this reads your agents' shell steps, without a model:
 *  - the same web address fetched by two or more agents (by host and the
 *    first part of its path), and
 *  - near-identical commands in two or more agents.
 * Each idea is a sentence ready to draft. Also: the sentence that turns one
 * step into a tool ("Make a tool from this step").
 */
import { createHash } from 'node:crypto';
import type { Agent, AgentNode, ToolDefinition } from '@some-useful-agents/core';

export interface ToolIdea {
  /** Stable: `host:<host/path>` or `cmd:<hash>`. */
  key: string;
  /** A few words for the card. */
  label: string;
  /** The sentence that goes in the Describe it box. */
  text: string;
  /** Why it's suggested ("Your agents a, b and c each fetch this."). */
  from: string;
  /** Ids of the agents it came from. */
  agents: string[];
}

export const MAX_TOOL_IDEAS = 5;
const MIN_COMMAND_CHARS = 20;
const NEAR_DUPLICATE = 0.6;

const URL_RE = /https?:\/\/([A-Za-z0-9.-]+\.[A-Za-z]{2,})(\/[^\s"'`$?#)]*)?(\?[^\s"'`#)]*)?/g;
const JQ_FIELD_RE = /\.([a-z_][a-z0-9_]{1,30})\b/gi;
const PY_FIELD_RE = /\[\s*["']([a-z_][a-z0-9_]{1,30})["']\s*\]/gi;
const NOT_FIELDS = new Set(['com', 'org', 'net', 'io', 'json', 'py', 'sh', 'txt', 'csv', 'html', 'environ', 'get', 'dumps', 'loads', 'stdin', 'stdout', 'argv', 'path', 'join']);

interface Step { agent: Agent; node: AgentNode; command: string }

function shellSteps(agents: readonly Agent[]): Step[] {
  const out: Step[] = [];
  for (const agent of agents) {
    if (agent.source !== 'local' || agent.status === 'archived') continue;
    for (const node of agent.nodes) {
      const command = node.type === 'shell' && !node.tool ? (node.command ?? '').trim() : '';
      if (command.length < MIN_COMMAND_CHARS) continue;
      // A stub that only prints fixed JSON isn't work worth a tool.
      if (/^(echo|printf|cat <<)\b/.test(command) && !/\|/.test(command) && !/https?:\/\//.test(command)) continue;
      out.push({ agent, node, command });
    }
  }
  return out;
}

function hostKey(host: string, path: string | undefined): string {
  const first = (path ?? '').split('/').filter(Boolean)[0];
  return first ? `${host.toLowerCase()}/${first}` : host.toLowerCase();
}

const agentList = (names: string[]): string => {
  const n = names.map((x) => `“${x}”`);
  return n.length <= 2 ? n.join(' and ') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
};

/** "“a”, “b” and “c”", or "“a”, “b”, “c” and 2 more". */
const someAgents = (names: string[]): string =>
  names.length <= 3 ? agentList(names) : `${names.slice(0, 3).map((x) => `“${x}”`).join(', ')} and ${names.length - 3} more`;

function fieldsUsed(commands: readonly string[]): string[] {
  const count = new Map<string, number>();
  for (const raw of commands) {
    const c = raw.replace(URL_RE, ' ');
    const seen = new Set<string>();
    for (const re of [JQ_FIELD_RE, PY_FIELD_RE]) {
      for (const m of c.matchAll(re)) {
        const f = m[1].toLowerCase();
        if (!NOT_FIELDS.has(f)) seen.add(f);
      }
    }
    for (const f of seen) count.set(f, (count.get(f) ?? 0) + 1);
  }
  const shared = [...count].filter(([, n]) => n >= 2 || commands.length === 1).sort((a, b) => b[1] - a[1]).map(([f]) => f);
  return shared.slice(0, 5);
}

function coveredByTool(tools: readonly ToolDefinition[], needle: string): boolean {
  const n = needle.toLowerCase();
  return tools.some((t) => `${t.implementation.command ?? ''} ${t.implementation.prompt ?? ''} ${t.description ?? ''}`.toLowerCase().includes(n));
}

const tokens = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length > 1));

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/** Up to MAX_TOOL_IDEAS ideas from your agents, most-shared first. Pure. */
export function toolIdeasFromAgents(agents: readonly Agent[], tools: readonly ToolDefinition[] = []): ToolIdea[] {
  const steps = shellSteps(agents);
  const ideas: Array<ToolIdea & { weight: number }> = [];

  // 1. The same address, fetched by several agents.
  const byHost = new Map<string, { host: string; path: string; params: Set<string>; steps: Step[] }>();
  for (const s of steps) {
    const seenHere = new Set<string>();
    for (const m of s.command.matchAll(URL_RE)) {
      const key = hostKey(m[1], m[2]);
      if (seenHere.has(key)) continue;
      seenHere.add(key);
      const g = byHost.get(key) ?? { host: m[1].toLowerCase(), path: (m[2] ?? '').split('/').filter(Boolean)[0] ?? '', params: new Set<string>(), steps: [] };
      for (const p of new URLSearchParams((m[3] ?? '').slice(1)).keys()) if (/^[a-z_][\w-]{0,30}$/i.test(p)) g.params.add(p);
      g.steps.push(s);
      byHost.set(key, g);
    }
  }
  const hostTaken = new Set<Step>();
  const shown: Array<Set<string>> = [];
  const byReach = [...byHost].sort((a, b) => new Set(b[1].steps.map((s) => s.agent.id)).size - new Set(a[1].steps.map((s) => s.agent.id)).size);
  for (const [key, g] of byReach) {
    const agentIds = [...new Set(g.steps.map((s) => s.agent.id))];
    if (agentIds.length < 2) continue;
    // A second address the same agents use (the site a story links to) isn't a second idea.
    if (shown.some((set) => agentIds.every((id) => set.has(id)))) { g.steps.forEach((s) => hostTaken.add(s)); continue; }
    const where = g.path ? `${g.host}/${g.path}` : g.host;
    // These steps are the shared fetch; they don't come back as "near-identical commands".
    g.steps.forEach((s) => hostTaken.add(s));
    if (coveredByTool(tools, g.host)) continue;
    shown.push(new Set(agentIds));
    const names = [...new Map(g.steps.map((s) => [s.agent.id, s.agent.name || s.agent.id])).values()];
    const fields = fieldsUsed(g.steps.map((s) => s.command));
    const params = [...g.params].slice(0, 4);
    const text = `Fetch from https://${where}${params.length ? `, taking ${params.join(', ')} as inputs` : ''}, and give back ${fields.length ? `the fields my agents pick out (${fields.join(', ')})` : 'the parts my agents use'} as JSON. My agents ${agentList(names.slice(0, 4))} each do this fetch in their own way now.`;
    ideas.push({
      key: `host:${key}`,
      label: `Fetch from ${g.host}`,
      text,
      from: `${names.length} of your agents fetch this: ${someAgents(names)}.`,
      agents: agentIds,
      weight: agentIds.length + 0.5,
    });
  }

  // 2. Near-identical commands in several agents (not already a shared fetch).
  const rest = steps.filter((s) => !hostTaken.has(s));
  const toks = rest.map((s) => tokens(s.command));
  const parent = rest.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      if (rest[i].agent.id === rest[j].agent.id) continue;
      if (jaccard(toks[i], toks[j]) >= NEAR_DUPLICATE) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Step[]>();
  rest.forEach((s, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), s]); });
  for (const g of groups.values()) {
    const agentIds = [...new Set(g.map((s) => s.agent.id))];
    if (agentIds.length < 2) continue;
    const first = g[0].command.split('\n')[0].trim();
    if (coveredByTool(tools, first.slice(0, 40))) continue;
    const names = [...new Map(g.map((s) => [s.agent.id, s.agent.name || s.agent.id])).values()];
    const hash = createHash('sha256').update(g[0].command).digest('hex').slice(0, 12);
    ideas.push({
      key: `cmd:${hash}`,
      label: `Reuse: ${first.length > 36 ? `${first.slice(0, 35)}…` : first}`,
      text: `Make one tool for what these steps do, with the values they hard-code as inputs:\n${g[0].command.slice(0, 600)}\n(My agents ${agentList(names.slice(0, 4))} each have a step like this.)`,
      from: `${names.length} of your agents have a step like this: ${someAgents(names)}.`,
      agents: agentIds,
      weight: agentIds.length,
    });
  }

  return ideas.sort((a, b) => b.weight - a.weight).slice(0, MAX_TOOL_IDEAS).map(({ weight: _w, ...i }) => i);
}

/** The Describe it sentence that turns one step into a tool, or undefined for a step that can't be one. */
export function toolIdeaFromStep(agent: Pick<Agent, 'id' | 'name'>, node: AgentNode): string | undefined {
  const body = node.type === 'shell' && !node.tool ? node.command
    : (node.type === 'llm-prompt' || node.type === 'claude-code') && !node.tool ? node.prompt
      : undefined;
  if (!body?.trim()) return undefined;
  const kind = node.type === 'shell' ? 'command' : 'prompt';
  const cut = body.length > 600 ? `${body.slice(0, 600)}…` : body;
  return `Make a reusable tool from the "${node.id}" step of my agent "${agent.name || agent.id}". Turn the values its ${kind} hard-codes into inputs. Its ${kind}:\n${cut.trim()}`;
}
