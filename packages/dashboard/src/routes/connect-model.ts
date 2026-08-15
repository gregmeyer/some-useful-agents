import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';
import { renderConnectModelPage } from '../views/connect-model.js';
import {
  getProviderReadiness,
  invalidateProviderReadiness,
  probeCustomProvider,
} from '../lib/provider-readiness.js';

export const connectModelRouter: Router = Router();

/**
 * Cookie set by "Skip for now". Purely a UI preference — it suppresses the
 * first-run redirect and nothing else, so it lives in a cookie rather than
 * earning a row in a store. Clearing cookies brings the gate back, which is
 * the right failure mode for something this cheap.
 */
export const MODEL_GATE_SKIP_COOKIE = 'sua_model_gate_skipped';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Turn a model id into a legal provider slug. `addCustomProvider` enforces
 * /^[a-z0-9][a-z0-9._-]*$/i, and real model ids routinely carry characters
 * that fail it ("unsloth/Qwen3-8B-GGUF:UD-Q4_K_XL").
 */
export function slugifyProviderName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  return slug || 'my-model';
}

connectModelRouter.get('/connect-model', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const readiness = getProviderReadiness(ctx);
  res.type('html').send(renderConnectModelPage({
    ready: readiness.ready,
    builtins: readiness.builtins,
    customs: readiness.customs,
    flash: typeof req.query.flash === 'string' ? req.query.flash : undefined,
    error: typeof req.query.error === 'string' ? req.query.error : undefined,
  }));
});

/**
 * Save an OpenAI-compatible endpoint AND put it at the front of the
 * waterfall.
 *
 * This is the ONLY route that defines a provider; `/settings/llm` manages the
 * ones that exist (order, disable, remove). Its old add form stopped at
 * "defined" and left chain placement to a second operator action, so "saved"
 * and "usable" were different states.
 *
 * Promotes rather than appends: the stock chain is `['claude']` even on a
 * machine with no claude binary, so appending would leave the new endpoint
 * parked behind a dead primary.
 */
connectModelRouter.post('/connect-model/connect', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.llmSettingsStore) {
    res.redirect(302, '/connect-model?error=' + encodeURIComponent('LLM settings store not configured.'));
    return;
  }

  const mode = str(req.body?.mode) === 'local' ? 'local' : 'hosted';
  const apiBase = str(req.body?.apiBase);
  const model = str(req.body?.model);
  const apiKey = str(req.body?.apiKey);
  const name = slugifyProviderName(str(req.body?.name) || model);
  const force = str(req.body?.force) === '1';

  const rerender = (opts: { error?: string; probe?: { ok: boolean; message: string }; offerForce?: boolean }) => {
    const readiness = getProviderReadiness(ctx);
    res.type('html').send(renderConnectModelPage({
      ready: readiness.ready,
      builtins: readiness.builtins,
      customs: readiness.customs,
      form: { mode, apiBase, model, name },
      ...opts,
    }));
  };

  if (!apiBase || !model) {
    rerender({ error: 'API base URL and model are both required.' });
    return;
  }

  // Probe before saving so the operator learns about a typo here, not two
  // screens later inside a failed run. `force` skips it after a failure.
  if (!force) {
    const probe = await probeCustomProvider({ apiBase, apiKey: apiKey || undefined });
    if (!probe.ok) {
      rerender({ probe, offerForce: true });
      return;
    }
  }

  try {
    ctx.llmSettingsStore.addCustomProvider({
      name,
      kind: 'openai',
      apiBase,
      apiKey: apiKey || undefined,
      model,
    });
    const current = ctx.llmSettingsStore.get().providers;
    ctx.llmSettingsStore.setProviders([name, ...current.filter((p) => p !== name)]);
  } catch (err) {
    rerender({ error: (err as Error).message });
    return;
  }

  invalidateProviderReadiness();
  // Land on the starters, not the (probably empty) home feed. "Connected a
  // model" and "here are three agents that use it" is the whole first-run
  // loop; sending them to `/` would make them go find the second half.
  res.redirect(302, '/start?ok=' + encodeURIComponent(`Connected "${name}". Pick one and run it.`));
});

/** Suppress the first-run gate without connecting anything. */
connectModelRouter.post('/connect-model/skip', (req: Request, res: Response) => {
  res.setHeader(
    'Set-Cookie',
    `${MODEL_GATE_SKIP_COOKIE}=1; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 365}`,
  );
  res.redirect(302, '/');
});
