import { describe, it, expect } from 'vitest';
import { buildWorkerPlist } from './worker.js';

describe('buildWorkerPlist', () => {
  const plist = buildWorkerPlist({
    nodePath: '/usr/bin/node',
    cliEntry: '/repo/packages/cli/dist/index.js',
    cwd: '/repo',
    env: { SUA_EXPERIMENTAL_APPLE: '1', PATH: '/opt/homebrew/bin:/usr/bin' },
    logPath: '/repo/data/daemon/logs/worker-launchagent.log',
  });

  it('declares the worker label and program arguments', () => {
    expect(plist).toContain('<string>com.some-useful-agents.worker</string>');
    expect(plist).toContain('<string>/usr/bin/node</string>');
    expect(plist).toContain('<string>/repo/packages/cli/dist/index.js</string>');
    expect(plist).toContain('<string>worker</string>');
    expect(plist).toContain('<string>start</string>');
  });

  it('runs at load, keeps alive, and sets the working directory', () => {
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(plist).toContain('<key>KeepAlive</key>\n  <true/>');
    expect(plist).toContain('<key>WorkingDirectory</key>\n  <string>/repo</string>');
  });

  it('renders the environment (so the flag + temporal config reach the worker)', () => {
    expect(plist).toContain('<key>SUA_EXPERIMENTAL_APPLE</key>');
    expect(plist).toContain('<string>1</string>');
    expect(plist).toContain('<key>PATH</key>');
  });

  it('xml-escapes special characters in paths', () => {
    const p = buildWorkerPlist({
      nodePath: '/usr/bin/node', cliEntry: '/a & b/cli.js', cwd: '/a & b',
      env: {}, logPath: '/a & b/w.log',
    });
    expect(p).toContain('/a &amp; b/cli.js');
    expect(p).not.toContain('/a & b/cli.js');
  });
});
