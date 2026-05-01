import { Router, type Request, type Response } from 'express';
import { spawnService, stopService, getServiceStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderSettingsShell } from '../views/settings-shell.js';
import { renderSettingsMcp } from '../views/settings-mcp.js';

/**
 * Routes for the outbound MCP server (the one Claude Desktop talks to).
 * Read-only status + start/stop. The bearer token is shared with this
 * dashboard's session cookie, so rotating it on /settings/general
 * invalidates both at once.
 */
export const settingsMcpRouter: Router = Router();

const DEFAULT_MCP_PORT = 3003;

settingsMcpRouter.get('/settings/mcp', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const status = getServiceStatus(ctx.dataDir, 'mcp');

  // Filter v2 agents to those exposed via MCP. Run counts come from the
  // run store so the operator can see which exposed agents are getting
  // exercised through Claude Desktop vs. sitting idle.
  const allAgents = ctx.agentStore.listAgents();
  const exposed = allAgents.filter((a) => a.mcp);
  const exposedAgents = exposed.map((agent) => {
    const { total } = ctx.runStore.queryRuns({ agentName: agent.id, limit: 1, offset: 0, statuses: [] });
    return { agent, runCount: total };
  });

  const tokenFingerprint = ctx.token.slice(0, 8);
  const endpoint = `http://127.0.0.1:${DEFAULT_MCP_PORT}/mcp`;
  const claudeDesktopConfig = renderClaudeDesktopConfig(endpoint, ctx.token);

  const errorParam = typeof req.query.error === 'string' ? req.query.error : undefined;
  const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const flash = errorParam
    ? { kind: 'error' as const, message: errorParam }
    : flashParam
    ? { kind: 'ok' as const, message: flashParam }
    : undefined;

  const body = renderSettingsMcp({
    status,
    tokenFingerprint,
    endpoint,
    exposedAgents,
    claudeDesktopConfig,
  });
  res.type('html').send(renderSettingsShell({ active: 'mcp', body, flash }));
});

settingsMcpRouter.post('/settings/mcp/start', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const suaBin = process.argv[1];
  if (!suaBin) {
    res.redirect(303, `/settings/mcp?error=${encodeURIComponent('Cannot determine the sua binary path. Run `sua mcp start` from the CLI.')}`);
    return;
  }
  try {
    const result = spawnService(ctx.dataDir, 'mcp', {
      suaBin,
      cwd: process.cwd(),
      env: process.env,
    });
    res.redirect(303, `/settings/mcp?flash=${encodeURIComponent(`MCP server started (PID ${result.pid}).`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/settings/mcp?error=${encodeURIComponent(`Start failed: ${msg}`)}`);
  }
});

settingsMcpRouter.post('/settings/mcp/stop', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  try {
    const result = stopService(ctx.dataDir, 'mcp');
    if (!result.signalled && result.pid === undefined) {
      res.redirect(303, `/settings/mcp?flash=${encodeURIComponent('MCP server was not running.')}`);
      return;
    }
    res.redirect(303, `/settings/mcp?flash=${encodeURIComponent(`Stopped MCP server (PID ${result.pid}).`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/settings/mcp?error=${encodeURIComponent(`Stop failed: ${msg}`)}`);
  }
});

/**
 * Build the JSON snippet a user pastes into Claude Desktop. The MCP
 * server speaks SSE/HTTP, so the client transport is `sse` with the
 * bearer token threaded through the Authorization header.
 */
function renderClaudeDesktopConfig(endpoint: string, token: string): string {
  // Mirrors the snippet `sua mcp start` prints to the terminal so users get
  // the same output regardless of where they copy it from.
  const config = {
    mcpServers: {
      'some-useful-agents': {
        url: endpoint,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };
  return JSON.stringify(config, null, 2);
}
