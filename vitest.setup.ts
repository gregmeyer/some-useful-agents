/**
 * No HTTP keep-alive in tests.
 *
 * Node ≥19's global agent keeps sockets alive. supertest starts a throwaway
 * server per request and closes it, but the idle kept-alive socket stays
 * pooled under host:port. Under a busy parallel run the OS hands a later
 * test's server the same ephemeral port, and a request goes down the pooled
 * socket to the EARLIER test's app (its stores, its agents) — so a random
 * route test got a 404 or stale state, or "socket hang up" when that old
 * server finally closed.
 */
import http from 'node:http';
import net from 'node:net';
import https from 'node:https';

http.globalAgent = new http.Agent({ keepAlive: false });
https.globalAgent = new https.Agent({ keepAlive: false });

/**
 * Test servers listen on 127.0.0.1, not every interface.
 *
 * supertest starts each server with `listen(0)`, which binds `::`, then
 * connects to 127.0.0.1. On macOS a wildcard bind succeeds even when another
 * process already holds 127.0.0.1 on that port, and the more specific bind
 * wins the connection — so a request went to some other program on the
 * machine and came back 404 or "read ECONNRESET", a different test each run.
 * Binding 127.0.0.1 makes the OS pick a port that is free there.
 *
 * supertest reads `address()` right after `listen(0)`, so the bind has to be
 * synchronous: `listen(0, '127.0.0.1')` resolves the host first and isn't.
 * `_listen2` is Node's synchronous bind (what `listen(0)` itself ends in).
 */
type SyncListen = { _listen2(address: string, port: number, addressType: number, backlog: number): void };
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (this: net.Server, ...args: unknown[]) {
  const [port, cb] = args;
  if (port === 0 && (args.length === 1 || (args.length === 2 && typeof cb === 'function'))) {
    if (typeof cb === 'function') this.once('listening', cb as () => void);
    (this as unknown as SyncListen)._listen2('127.0.0.1', 0, 4, 511);
    return this;
  }
  return (listen as (...a: unknown[]) => net.Server).apply(this, args);
} as typeof net.Server.prototype.listen;
