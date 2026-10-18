import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseAgent } from '@some-useful-agents/core';

// firmographic-research researches each company through research-fanout;
// code builds the records from what it found, and the model only scores fit.

const root = join(__dirname, '../../../..');
const agent = parseAgent(readFileSync(join(root, 'agents/examples', 'firmographic-research.yaml'), 'utf8'));
const run = (nodeId: string, env: Record<string, string>) => {
  const cmd = agent.nodes.find((n) => n.id === nodeId)!.command!;
  const out = execFileSync('sh', ['-c', cmd], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').at(-1)!) as Record<string, any>;
};

describe('firmographic-research', () => {
  it('researches the companies through research-fanout, not one long step', () => {
    const research = agent.nodes.find((n) => n.id === 'research')!;
    expect(research).toMatchObject({ type: 'agent-invoke', agentInvokeConfig: { agentId: 'research-fanout' } });
    expect(research.agentInvokeConfig!.inputMapping!.ITEMS).toBe('$upstream.list.items_json');
    expect(agent.nodes.filter((n) => n.type === 'llm-prompt' && n.tools?.length)).toEqual([]);
  });

  it('caps the plan and passes each company with its website and description', () => {
    const out = run('list', {
      UPSTREAM_PLAN_RESULT: JSON.stringify({ companies: [
        { company: 'Runway', website_hint: 'runway.com', description_hint: 'business planning software, not Runway ML' },
        { company: 'Vena', website_hint: '', description_hint: '' },
        { company: 'vena' },
        { company: 'Planful' },
      ] }),
      MAX_COMPANIES_PER_RUN: '2',
    });
    expect(out.selected_companies).toEqual(['Runway', 'Vena']);
    expect(out.omitted_companies).toBe('Planful');
    expect(JSON.parse(out.items_json)).toEqual([
      { subject: 'Runway (runway.com)', hint: 'business planning software, not Runway ML Its website is runway.com.' },
      { subject: 'Vena', hint: '' },
    ]);
  });

  it('builds records from the research only, turns ranges into numbers, and keeps the model to fit', () => {
    const list = JSON.stringify({ selected_companies: ['Vena', 'Lightspeed'], omitted_companies: '' });
    const fan = { headline: '1 of 2 researched; Lightspeed didn\'t finish.', unfinished: ['Lightspeed'], results: [
      { subject: 'Vena', status: 'done', found: {
        website: { value: 'https://www.venasolutions.com', source: 'https://www.venasolutions.com/about' },
        employees: { value: { min: 500, max: 1000 }, source: 'https://www.linkedin.com/company/vena', quote: '501-1,000 employees' },
        revenue: { value: '$100M+', source: 'https://example.com/vena' },
        founded: { value: 2011, source: 'https://www.venasolutions.com/about' },
      }, not_found: ['why_buy', 'value_offered'], summary: 'FP&A software.', note: '' },
      { subject: 'Lightspeed', status: "didn't finish", found: {}, not_found: [], summary: '', note: '' },
    ] };
    const records = run('records', { UPSTREAM_LIST_RESULT: list, UPSTREAM_RESEARCH_RESULT: JSON.stringify(fan) });
    const vena = records.companies[0];
    expect(vena).toMatchObject({ company: 'Vena', website: 'https://www.venasolutions.com', employees: 750, revenue: 100000000, founded: '2011', why_buy: 'not found' });
    expect(vena.source_urls).toEqual(['https://www.venasolutions.com/about', 'https://www.linkedin.com/company/vena', 'https://example.com/vena']);
    expect(vena.conflicts).toContain('employees {"min": 500, "max": 1000} taken as 750');
    expect(records.companies[1]).toMatchObject({ company: 'Lightspeed', status: "didn't finish", website: 'not found' });

    // The model scores fit; it can't change a fact, and an unfinished one scores 0.
    const syn = JSON.stringify({ scores: [
      { company: 'Vena', fit: 96, confidence: 'medium', why: 'an FP&A peer.' },
      { company: 'Lightspeed', fit: 80, confidence: 'high', employees: 9999 },
    ], headline: 'One clear peer', bullets: [{ point: 'Vena is mid-size', source_url: 'https://www.linkedin.com/company/vena' }, { point: 'made up', source_url: 'https://nowhere.example' }], tension: 'Lightspeed unresolved' });
    const out = run('validate-output', { UPSTREAM_RECORDS_RESULT: JSON.stringify(records), UPSTREAM_SYNTHESIZE_RESULT: syn });
    expect(out.companies.map((c: { fit: number; employees: unknown }) => [c.fit, c.employees])).toEqual([[96, 750], [0, 'not found']]);
    expect(out.companies[0].conflicts).toMatch(/Fit: an FP&A peer\.$/);
    expect(out.bullets).toHaveLength(1);
    expect(out.headline).toBe("One clear peer (Lightspeed didn't finish)");
    expect(out.unfinished).toEqual(['Lightspeed']);
    expect(out.summary_stats[1]).toMatchObject({ label: 'Researched', value: 1, tone: 'warn' });
  });
});
