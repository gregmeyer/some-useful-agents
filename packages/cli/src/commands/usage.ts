import { Command } from 'commander';
import chalk from 'chalk';
import { formatTokens, formatUsd } from '@some-useful-agents/core';
import { openStores } from '../v2-runtime.js';
import * as ui from '../ui.js';

/**
 * `sua usage` — what agent runs cost over the last N days, by agent and by
 * provider/model. USD at list price (docs/cost.md).
 */
export const usageCommand = new Command('usage')
  .description('Show what agent runs cost (USD at list price) and the tokens they used')
  .option('-d, --days <n>', 'How many days back', '7')
  .option('-a, --agent <id>', 'Only this agent')
  .action((opts: { days: string; agent?: string }) => {
    const days = Math.max(1, parseInt(opts.days, 10) || 7);
    const stores = openStores();
    try {
      const s = stores.runs.usageSummary(new Date(Date.now() - days * 86_400_000).toISOString(), { agentName: opts.agent });
      ui.section(`Usage — last ${days} day${days === 1 ? '' : 's'}${opts.agent ? ` — ${opts.agent}` : ''}`);
      console.log(`  ${chalk.bold(formatUsd(s.totalUsd, s.complete))} ${ui.dim('USD at list price, incl. agents each run called')}`);
      if (s.byAgent.length === 0) {
        console.log(ui.dim('  No runs with recorded usage in this period.'));
        return;
      }
      console.log('');
      console.log(ui.dim('  By agent'));
      for (const a of s.byAgent) {
        console.log(`  ${formatUsd(a.costUsd, a.costComplete).padStart(9)}  ${a.agent}  ${ui.dim(`${a.runs} run${a.runs === 1 ? '' : 's'} · ${formatTokens(a.inputTokens)} in / ${formatTokens(a.outputTokens)} out`)}`);
      }
      console.log('');
      console.log(ui.dim('  By provider'));
      for (const p of s.byProvider) {
        const cost = p.unpricedTokens > 0 && p.costUsd === 0 ? 'no price' : formatUsd(p.costUsd, p.unpricedTokens === 0);
        console.log(`  ${cost.padStart(9)}  ${p.provider}${p.model ? `/${p.model}` : ''}  ${ui.dim(`${p.calls} call${p.calls === 1 ? '' : 's'} · ${formatTokens(p.inputTokens)} in / ${formatTokens(p.outputTokens)} out`)}`);
      }
      if (!s.complete) {
        console.log('');
        console.log(ui.dim('  Some tokens have no price, so totals are a lower bound. Set prices in the dashboard: Settings → LLM → Pricing.'));
      }
    } finally {
      stores.close();
    }
  });
