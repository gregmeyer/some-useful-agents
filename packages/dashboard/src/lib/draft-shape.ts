import { parseAgent, type Agent } from '@some-useful-agents/core';
import { miniDag, describeDag, type MiniDagNode } from '../views/mini-dag.js';
import { autoFixYaml } from '../routes/run-now-build.js';

/**
 * What a drafted agent looks like, for the build review: a goal node that
 * works it out, or a fixed flow of steps. `diagramHtml` is the same
 * server-rendered mini diagram the agents list uses (empty for one node).
 */
export interface DraftShape {
  kind: 'goal' | 'flow' | 'invalid';
  label: string;
  /** Present when the draft is a goal agent or a flow — the other one. */
  switchTo?: 'goal' | 'flow';
  diagramHtml: string;
  /** Tools and agents the draft may call or run. */
  tools: string[];
  error?: string;
}

function toMiniDag(agent: Agent): MiniDagNode[] {
  return agent.nodes.map((n) => ({
    id: n.id,
    dependsOn: n.dependsOn,
    conditional: Boolean(n.onlyIf),
    type: n.type,
    tools: n.tools,
  }));
}

/** Tools a draft uses: model-callable `tools`, tool nodes, and agents it runs. */
function draftTools(agent: Agent): string[] {
  const out = new Set<string>();
  for (const n of agent.nodes) {
    for (const t of n.tools ?? []) out.add(t);
    if (n.tool) out.add(n.tool);
    const invoked = n.loopConfig?.agentId ?? n.agentInvokeConfig?.agentId;
    if (invoked) out.add(`agent:${invoked}`);
  }
  return [...out];
}

export function describeDraftShape(yaml: string): DraftShape {
  let agent: Agent;
  try {
    agent = parseAgent(autoFixYaml(yaml));
  } catch (err) {
    return { kind: 'invalid', label: "Doesn't parse yet", diagramHtml: '', tools: [], error: (err as Error).message.split('\n')[0] };
  }
  const nodes = agent.nodes;
  const goals = nodes.filter((n) => n.type === 'goal').length;
  const tools = draftTools(agent);
  const dag = toMiniDag(agent);
  const diagramHtml = String(miniDag(dag, { title: describeDag(dag) }));
  if (nodes.length === 1 && goals === 1) {
    return { kind: 'goal', label: 'One goal node: works it out itself, step by step', switchTo: 'flow', diagramHtml, tools };
  }
  const steps = `${nodes.length}-step flow`;
  return {
    kind: 'flow',
    label: goals > 0
      ? `${steps} with a goal step: fixed steps around one open-ended step`
      : nodes.length === 1 ? 'One step: the same every run' : `${steps}: the same steps every run`,
    switchTo: goals > 0 ? undefined : 'goal',
    diagramHtml,
    tools,
  };
}
