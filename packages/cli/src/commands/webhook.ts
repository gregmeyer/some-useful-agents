import { Command } from 'commander';
import chalk from 'chalk';
import { WebhookStore } from '@some-useful-agents/core';
import { loadConfig, getDashboardBaseUrl } from '../config.js';
import { openStores } from '../v2-runtime.js';
import * as ui from '../ui.js';

/**
 * `sua agent webhook <agent>` — show, turn on/off, or rotate an agent's
 * inbound webhook (docs/webhooks.md).
 */
export const webhookCommand = new Command('webhook')
  .description("Show or change an agent's inbound webhook (POST /hooks/<agent>)")
  .argument('<agent>', 'Agent id')
  .option('--on', 'Turn the webhook on (creates its secret the first time)')
  .option('--off', 'Turn the webhook off (deliveries get 404)')
  .option('--rotate', 'Replace the secret; the old one stops working')
  .action((agentId: string, opts: { on?: boolean; off?: boolean; rotate?: boolean }) => {
    const stores = openStores();
    try {
      const agent = stores.agents.getAgent(agentId);
      if (!agent) { ui.fail(`Agent "${agentId}" not found.`); process.exitCode = 1; return; }
      const hooks = WebhookStore.fromHandle(stores.db);
      if (opts.on) hooks.enable(agent.id);
      if (opts.off) hooks.disable(agent.id);
      if (opts.rotate && !hooks.rotate(agent.id)) { ui.fail('Turn the webhook on first (--on).'); process.exitCode = 1; return; }
      const hook = hooks.get(agent.id);
      ui.section(`Webhook — ${agent.id}`);
      if (!hook || !hook.enabled) {
        console.log(`  ${chalk.gray('off')}  ${ui.dim(`turn it on with: sua agent webhook ${agent.id} --on`)}`);
        return;
      }
      const base = getDashboardBaseUrl(loadConfig()).replace(/\/+$/, '');
      console.log(`  ${chalk.green('on')}${agent.webhook?.signature === 'github' ? ui.dim('  (GitHub-signed deliveries only)') : ''}`);
      console.log(`  URL     POST ${base}/hooks/${agent.id}`);
      console.log(`  Secret  ${hook.token}`);
      console.log(`  Last    ${hook.lastDeliveryAt ? `${hook.lastDeliveryAt} · ${hook.lastStatus ?? ''}${hook.lastRunId ? ` · run ${hook.lastRunId.slice(0, 8)}` : ''}` : 'no deliveries yet'}`);
      console.log('');
      console.log(ui.dim(`  curl -X POST ${base}/hooks/${agent.id} -H "Authorization: Bearer ${hook.token}" -H "Content-Type: application/json" -d '{}'`));
    } finally {
      stores.close();
    }
  });
