import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseAgent, withShellHelpers } from '@some-useful-agents/core';

// starter-research researches each angle through research-fanout; code
// numbers the findings with their pages, and the brief cites them by number.

const root = join(__dirname, '../../../..');
const agent = parseAgent(readFileSync(join(root, 'agents/examples', 'starter-research.yaml'), 'utf8'));
const run = (nodeId: string, env: Record<string, string>) => {
  const cmd = agent.nodes.find((n) => n.id === nodeId)!.command!;
  const out = execFileSync('sh', ['-c', cmd], { env: withShellHelpers({ PATH: process.env.PATH ?? '', ...env }), encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').at(-1)!) as Record<string, any>;
};

describe('starter-research', () => {
  it('researches its angles through research-fanout, not one long step per side', () => {
    const research = agent.nodes.find((n) => n.id === 'research')!;
    expect(research).toMatchObject({ type: 'agent-invoke', optional: true, agentInvokeConfig: { agentId: 'research-fanout' } });
    expect(research.agentInvokeConfig!.inputMapping).toMatchObject({ ITEMS: '$upstream.angles.items_json', ASK: '$upstream.angles.ask_json' });
    expect(agent.nodes.filter((n) => n.type === 'llm-prompt' && n.tools?.length)).toEqual([]);
    expect(research.dependsOn).toContain('angles');
    expect(agent.nodes.some((n) => n.dependsOn?.includes(research.id)), 'nothing reads the research').toBe(true);
  });

  it("takes the plan's angles up to the depth's cap, always with one skeptical angle", () => {
    const plan = 'split\n' + JSON.stringify({ angles: [
      { subject: 'What it is', hint: 'basics', side: 'main' },
      { subject: 'Who uses it', hint: '', side: 'main' },
      { subject: 'What it costs', hint: '', side: 'main' },
      { subject: 'Where it falls short', hint: 'limits', side: 'counter' },
    ] });
    const quick = run('angles', { TOPIC: 'local-first software', DEPTH: 'quick', UPSTREAM_PLAN_RESULT: plan });
    expect(quick.angles.map((a: { subject: string }) => a.subject)).toEqual(['What it is', 'Who uses it', 'Where it falls short']);
    expect(JSON.parse(quick.items_json)[2]).toEqual({ subject: 'Where it falls short', hint: 'limits (the skeptical side)' });
    expect(JSON.parse(quick.ask_json)).toHaveLength(3);
    const thorough = run('angles', { TOPIC: 'local-first software', DEPTH: 'thorough', UPSTREAM_PLAN_RESULT: plan });
    expect(thorough.count).toBe(4);
    expect(JSON.parse(thorough.ask_json)).toHaveLength(5);
    expect(thorough.context).toContain('about twice that');
  });

  it('without a plan (it failed), researches the topic and its case against', () => {
    const out = run('angles', { TOPIC: 'SQLite in production', DEPTH: 'quick', UPSTREAM_PLAN_RESULT: '(step "plan" didn\'t finish: timed out)' });
    expect(out.planned).toBe(false);
    expect(out.angles.map((a: { side: string }) => a.side)).toEqual(['main', 'counter']);
    expect(out.angles[1].subject).toBe('The case against, limits and risks: SQLite in production');
  });

  it('numbers sourced findings, cites them in the brief, and says which side is missing', () => {
    const angles = JSON.stringify({ angles: [
      { subject: 'Where SQLite works', hint: '', side: 'main' },
      { subject: 'Where it breaks down', hint: '', side: 'counter' },
    ] });
    const fan = { headline: "1 of 2 researched; Where it breaks down didn't finish.", results: [
      { subject: 'Where SQLite works', status: 'done', summary: 'Fine for most sites.', found: {
        finding_2: { value: 'Handles 100K hits/day', source: 'https://www.sqlite.org/whentouse.html', quote: 'should work fine for any site that gets fewer than 100K hits/day' },
        finding_1: { value: 'Used in every phone', source: 'https://www.sqlite.org/mostdeployed.html' },
        finding_3: { value: 'From memory', source: 'notebook' },
      } },
      { subject: 'Where it breaks down', status: "didn't finish", found: {}, summary: '' },
    ] };
    const findings = run('findings', { UPSTREAM_ANGLES_RESULT: angles, UPSTREAM_RESEARCH_RESULT: `ran\n${JSON.stringify(fan)}` });
    // In key order; a finding with no page is left out.
    expect(findings.angles[0].findings.map((x: { id: string; point: string }) => `${x.id} ${x.point}`)).toEqual(['F1 Used in every phone', 'F2 Handles 100K hits/day']);
    expect(findings.angles[0].findings[1]).toMatchObject({ source_title: 'sqlite.org', source_url: 'https://www.sqlite.org/whentouse.html' });
    expect(findings).toMatchObject({ finding_count: 2, source_count: 2, unfinished: ['Where it breaks down'], missing_sides: ['counter'] });

    const brief = run('brief', {
      UPSTREAM_FINDINGS_RESULT: JSON.stringify(findings),
      UPSTREAM_SYNTHESIZE_RESULT: 'brief\n' + JSON.stringify({ headline: 'SQLite suits most low-write sites.', tension: '', bullets: [
        { point: 'It handles sites under 100K hits a day.', finding: 'F2' },
        { point: 'It is the most deployed database.', finding: 'f1' },
        { point: 'It scales to any write load.', finding: 'F9' },
      ] }),
    });
    expect(brief.bullets).toEqual([
      { point: 'It handles sites under 100K hits a day.', source_title: 'sqlite.org', source_url: 'https://www.sqlite.org/whentouse.html' },
      { point: 'It is the most deployed database.', source_title: 'sqlite.org', source_url: 'https://www.sqlite.org/mostdeployed.html' },
    ]);
    expect(brief).toMatchObject({ source_count: '2', unfinished: "Didn't finish: Where it breaks down" });
    expect(brief.tension).toBe("The skeptical side couldn't be researched this time, so this brief is one-sided.");
  });

  it('shows the findings themselves when the brief step gives nothing', () => {
    const findings = { angles: [{ angle: 'a', side: 'main', status: 'done', summary: '', findings: [
      { id: 'F1', point: 'One', source_url: 'https://a.example/x', source_title: 'a.example', quote: '' },
    ] }], source_count: 1, unfinished: [], missing_sides: [] };
    const brief = run('brief', { UPSTREAM_FINDINGS_RESULT: JSON.stringify(findings), UPSTREAM_SYNTHESIZE_RESULT: '(step "synthesize" didn\'t finish: timed out)' });
    expect(brief.headline).toContain("the brief couldn't be written");
    expect(brief.bullets).toEqual([{ point: 'One', source_title: 'a.example', source_url: 'https://a.example/x' }]);
  });
});
