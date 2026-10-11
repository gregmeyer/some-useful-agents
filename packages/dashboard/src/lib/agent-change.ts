/**
 * What a proposed agent change does, in plain words, for the edit card above
 * its YAML diff: "New step · enrich calls firmographic-research, after
 * synthesize". Pure; YAML that doesn't parse gives no lines (the diff still
 * shows).
 */
import { parseAgent, type Agent, type AgentNode } from '@some-useful-agents/core';

export interface AgentChangeLine {
  /** The kind of change: "New step", "Removed step", "Prompt", … */
  what: string;
  /** What changed, in words (node ids and agent ids as they are). */
  detail: string;
}

const calls = (n: AgentNode): string | undefined =>
  n.type === 'agent-invoke' ? n.agentInvokeConfig?.agentId : n.type === 'loop' ? n.loopConfig?.agentId : undefined;

const after = (n: AgentNode): string => (n.dependsOn?.length ? `, after ${n.dependsOn.join(', ')}` : '');

/** One added node, said by what it does. */
function newStep(n: AgentNode): string {
  const agent = calls(n);
  if (n.type === 'agent-invoke' && agent) return `${n.id} calls ${agent}${after(n)}`;
  if (n.type === 'loop' && agent) return `${n.id} runs ${agent} for each item${after(n)}`;
  return `${n.id} (${n.type})${after(n)}`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function describeAgentChange(beforeYaml: string, afterYaml: string): AgentChangeLine[] {
  let a: Agent, b: Agent;
  try {
    a = parseAgent(beforeYaml);
    b = parseAgent(afterYaml.replace(/\{ \{/g, '{{')); // as the editor commits it
  } catch {
    return [];
  }
  const lines: AgentChangeLine[] = [];
  const before = new Map(a.nodes.map((n) => [n.id, n]));
  const now = new Map(b.nodes.map((n) => [n.id, n]));
  for (const n of b.nodes) if (!before.has(n.id)) lines.push({ what: 'New step', detail: newStep(n) });
  for (const n of a.nodes) if (!now.has(n.id)) lines.push({ what: 'Removed step', detail: calls(n) ? `${n.id} (called ${calls(n)!})` : n.id });
  for (const n of b.nodes) {
    const o = before.get(n.id);
    if (!o) continue;
    const parts: AgentChangeLine[] = [];
    if (o.type !== n.type) parts.push({ what: 'Step type', detail: `${n.id}: ${o.type} → ${n.type}` });
    if (calls(o) !== calls(n) && calls(n)) parts.push({ what: 'Calls', detail: `${n.id} now calls ${calls(n)!}${calls(o) ? ` instead of ${calls(o)!}` : ''}` });
    if (!same(o.prompt, n.prompt)) parts.push({ what: 'Prompt', detail: `${n.id}'s prompt is rewritten` });
    if (!same(o.command, n.command)) parts.push({ what: 'Command', detail: `${n.id}'s command changes` });
    if (!same(o.dependsOn, n.dependsOn)) parts.push({ what: 'Order', detail: n.dependsOn?.length ? `${n.id} now runs after ${n.dependsOn.join(', ')}` : `${n.id} now runs first` });
    if (parts.length) lines.push(...parts);
    else if (!same(o, n)) lines.push({ what: 'Settings', detail: `${n.id}'s settings change` });
  }
  const ins = Object.keys(b.inputs ?? {}).filter((k) => !(k in (a.inputs ?? {})));
  const outs = Object.keys(a.inputs ?? {}).filter((k) => !(k in (b.inputs ?? {})));
  if (ins.length) lines.push({ what: ins.length === 1 ? 'New input' : 'New inputs', detail: ins.join(', ') });
  if (outs.length) lines.push({ what: outs.length === 1 ? 'Removed input' : 'Removed inputs', detail: outs.join(', ') });
  if (!same(a.description, b.description)) lines.push({ what: 'Description', detail: 'rewritten' });
  return lines;
}
