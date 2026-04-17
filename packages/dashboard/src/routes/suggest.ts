import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  exportAgent,
  parseAgent,
  AgentYamlParseError,
  invokeLlm,
  detectLlms,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import {
  renderSuggestForm,
  renderSuggestPolling,
  renderSuggestResult,
  renderSuggestFragment,
  DEFAULT_PROMPT,
} from '../views/suggest.js';

export const suggestRouter: Router = Router();

// ── In-memory job store ────────────────────────────────────────────────

type Classification = 'NO_IMPROVEMENTS' | 'SUGGESTIONS' | 'REWRITE';

interface SuggestionJob {
  agentId: string;
  status: 'pending' | 'done' | 'error';
  classification?: Classification;
  summary?: string;
  details?: string;
  suggestedYaml?: string;
  rawOutput?: string;
  error?: string;
  startedAt: number;
}

const jobs = new Map<string, SuggestionJob>();
const JOB_TTL_MS = 10 * 60 * 1000; // 10 minutes

function pruneStaleJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

// ── Response parser ────────────────────────────────────────────────────

function extractTag(text: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const m = text.match(re);
  return m ? m[1].trim() : undefined;
}

function parseResponse(raw: string): Pick<SuggestionJob, 'classification' | 'summary' | 'details' | 'suggestedYaml'> {
  const classRaw = extractTag(raw, 'classification');
  let classification: Classification = 'SUGGESTIONS';
  if (classRaw) {
    const upper = classRaw.toUpperCase().trim();
    if (upper === 'NO_IMPROVEMENTS' || upper === 'SUGGESTIONS' || upper === 'REWRITE') {
      classification = upper;
    }
  }

  const summary = extractTag(raw, 'summary') ?? 'See details below.';
  const details = extractTag(raw, 'details') ?? raw;
  const yaml = extractTag(raw, 'yaml') ?? undefined;
  const suggestedYaml = yaml && yaml.length > 10 ? yaml : undefined;

  return { classification, summary, details, suggestedYaml };
}

// ── Routes ─────────────────────────────────────────────────────────────

suggestRouter.get('/agents/:id/suggest', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  const llmStatus = detectLlms();
  const currentYaml = exportAgent(agent);
  const error = typeof req.query.error === 'string' ? req.query.error : undefined;

  res.type('html').send(renderSuggestForm({
    agent,
    defaultPrompt: DEFAULT_PROMPT,
    currentYaml,
    llmAvailable: llmStatus.claude.installed,
    error,
  }));
});

suggestRouter.post('/agents/:id/suggest', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const userPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : DEFAULT_PROMPT;
  const currentYaml = exportAgent(agent);
  const fullPrompt = `${userPrompt}\n\nHere is the agent YAML:\n\n${currentYaml}`;

  pruneStaleJobs();

  const jobId = randomUUID();
  const job: SuggestionJob = {
    agentId: id,
    status: 'pending',
    startedAt: Date.now(),
  };
  jobs.set(jobId, job);

  // Fire-and-forget — the polling route picks up the result.
  invokeLlm({ prompt: fullPrompt, provider: 'claude', timeoutMs: 120_000 })
    .then((result) => {
      if (result.exitCode !== 0) {
        job.status = 'error';
        job.error = result.error ?? `Claude exited with code ${result.exitCode}`;
        job.rawOutput = result.output;
        return;
      }
      const parsed = parseResponse(result.output);
      job.status = 'done';
      job.classification = parsed.classification;
      job.summary = parsed.summary;
      job.details = parsed.details;
      job.suggestedYaml = parsed.suggestedYaml;
      job.rawOutput = result.output;
    })
    .catch((err) => {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
    });

  res.redirect(303, `/agents/${encodeURIComponent(id)}/suggest/${jobId}`);
});

suggestRouter.get('/agents/:id/suggest/:jobId', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  const job = jobs.get(jobId);
  if (!job) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}/suggest?error=${encodeURIComponent('Suggestion expired or not found. Try again.')}`);
    return;
  }

  const partial = req.query.partial === '1';
  const currentYaml = exportAgent(agent);

  if (partial) {
    res.type('html').send(renderSuggestFragment({ agent, job, jobId, currentYaml }));
    return;
  }

  if (job.status === 'pending') {
    res.type('html').send(renderSuggestPolling({ agent, jobId }));
    return;
  }

  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  res.type('html').send(renderSuggestResult({ agent, job, currentYaml, error }));
});

suggestRouter.post('/agents/:id/suggest/apply', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const suggestedYaml = typeof body.suggestedYaml === 'string' ? body.suggestedYaml : '';
  const jobId = typeof body.jobId === 'string' ? body.jobId : '';

  if (!suggestedYaml.trim()) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}?flash=${encodeURIComponent('No YAML to apply.')}`);
    return;
  }

  let parsed;
  try {
    parsed = parseAgent(suggestedYaml);
  } catch (err) {
    const msg = err instanceof AgentYamlParseError ? err.message : `Parse error: ${(err as Error).message}`;
    const redirect = jobId
      ? `/agents/${encodeURIComponent(id)}/suggest/${jobId}?error=${encodeURIComponent(msg)}`
      : `/agents/${encodeURIComponent(id)}?flash=${encodeURIComponent(msg)}`;
    res.redirect(303, redirect);
    return;
  }

  if (parsed.id !== agent.id) {
    const msg = `Agent id in suggested YAML ("${parsed.id}") doesn't match "${agent.id}". Cannot apply.`;
    res.redirect(303, `/agents/${encodeURIComponent(id)}?flash=${encodeURIComponent(msg)}`);
    return;
  }

  try {
    ctx.agentStore.createNewVersion(
      agent.id,
      {
        id: parsed.id,
        name: parsed.name,
        description: parsed.description,
        status: parsed.status,
        schedule: parsed.schedule,
        source: agent.source, // preserve trust level
        mcp: parsed.mcp,
        nodes: parsed.nodes,
        inputs: parsed.inputs,
        signal: parsed.signal,
        author: parsed.author,
        tags: parsed.tags,
      },
      'dashboard',
      'Applied AI-suggested improvements',
    );
    res.redirect(303, `/agents/${encodeURIComponent(id)}?flash=${encodeURIComponent('Applied AI suggestions. New version created.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(id)}?flash=${encodeURIComponent(`Apply failed: ${msg}`)}`);
  }
});
