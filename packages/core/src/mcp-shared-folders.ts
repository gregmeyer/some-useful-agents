/**
 * Where a tool server that runs in Docker puts files you can open.
 *
 * A server started as `docker run -v /host/dir:/app/output -w /app …` writes
 * inside its container: a path it reports (`/app/output/a.png`, or
 * `output/a.png` against its working folder) only exists on this computer
 * under the folder it shares (`/host/dir/a.png`). These read the shares from a
 * server's own start command, so sua can show and keep what it made. A path
 * outside every shared folder stays inside the container and can't be read.
 */
import { homedir } from 'node:os';
import { posix } from 'node:path';
import type { McpServerConfig } from './mcp-server-types.js';

/** A folder a Docker-run server shares with this computer. */
export interface McpSharedFolder {
  /** The server's id. */
  server: string;
  /** The folder on this computer. */
  host: string;
  /** The same folder inside the container. */
  inside: string;
}

const DOCKER = /(^|\/)(docker|podman)$/;

function expandHome(p: string): string {
  return p === '~' ? homedir() : p.startsWith('~/') ? posix.join(homedir(), p.slice(2)) : p;
}

/** The working folder and shared folders a server's `docker run` command sets up (none when it isn't one). */
export function dockerShares(server: Pick<McpServerConfig, 'id' | 'command' | 'args' | 'transport'>): { workdir?: string; image?: string; folders: McpSharedFolder[] } {
  const args = server.args ?? [];
  if (server.transport !== 'stdio' || !server.command || !DOCKER.test(server.command) || !args.includes('run')) return { folders: [] };
  const folders: McpSharedFolder[] = [];
  let workdir: string | undefined;
  let image: string | undefined;
  const add = (host: string | undefined, inside: string | undefined) => {
    if (!host || !inside) return;
    const h = expandHome(host);
    // A named volume (no slash) isn't a folder on this computer.
    if (!h.startsWith('/') || !inside.startsWith('/')) return;
    folders.push({ server: server.id, host: posix.normalize(h).replace(/\/$/, '') || '/', inside: posix.normalize(inside).replace(/\/$/, '') || '/' });
  };
  const valueOf = (i: number, flags: readonly string[]): { value?: string; skip: number } => {
    const a = args[i];
    for (const f of flags) {
      if (a === f) return { value: args[i + 1], skip: 1 };
      if (a.startsWith(`${f}=`)) return { value: a.slice(f.length + 1), skip: 0 };
    }
    return { skip: -1 };
  };
  for (let i = args.indexOf('run') + 1; i < args.length; i += 1) {
    const a = args[i];
    // The image name ends docker's own options; what follows is the server's.
    if (!a.startsWith('-')) {
      const prev = args[i - 1] ?? '';
      if (!/^-[a-zA-Z]$|^--[a-z-]+$/.test(prev) || /^(-i|-t|-it|-d|--rm|--init|--interactive|--tty|--privileged|--read-only)$/.test(prev)) { image = a; break; }
      continue;
    }
    const vol = valueOf(i, ['-v', '--volume']);
    if (vol.skip >= 0) {
      const [host, inside] = (vol.value ?? '').split(':');
      add(host, inside);
      i += vol.skip;
      continue;
    }
    const mount = valueOf(i, ['--mount']);
    if (mount.skip >= 0) {
      const kv = new Map((mount.value ?? '').split(',').map((p) => { const [k, ...v] = p.split('='); return [k.trim(), v.join('=')] as const; }));
      if ((kv.get('type') ?? 'volume') === 'bind') add(kv.get('source') ?? kv.get('src'), kv.get('target') ?? kv.get('destination') ?? kv.get('dst'));
      i += mount.skip;
      continue;
    }
    const wd = valueOf(i, ['-w', '--workdir']);
    if (wd.skip >= 0) {
      if (wd.value?.startsWith('/')) workdir = posix.normalize(wd.value);
      i += wd.skip;
    }
  }
  return { ...(workdir ? { workdir } : {}), ...(image ? { image } : {}), folders };
}

/** Every folder the enabled Docker-run servers share with this computer. */
export function mcpSharedFolders(servers: readonly McpServerConfig[]): McpSharedFolder[] {
  return servers.filter((s) => s.enabled).flatMap((s) => dockerShares(s).folders);
}

/**
 * Where a path a server reported is on this computer: an absolute path inside
 * a shared folder, or a relative one read against the server's working
 * folder. Undefined when it's in no shared folder (it stayed in the container).
 */
export function hostPathFor(path: string, servers: readonly McpServerConfig[]): string | undefined {
  const p = path.trim();
  if (!p) return undefined;
  for (const s of servers) {
    if (!s.enabled) continue;
    const { workdir, folders } = dockerShares(s);
    if (!folders.length) continue;
    const inside = p.startsWith('/') ? posix.normalize(p) : workdir ? posix.join(workdir, p) : undefined;
    if (!inside) continue;
    for (const f of folders) {
      if (inside === f.inside) return f.host;
      if (inside.startsWith(`${f.inside === '/' ? '' : f.inside}/`)) return posix.join(f.host, inside.slice(f.inside.length));
    }
  }
  return undefined;
}
