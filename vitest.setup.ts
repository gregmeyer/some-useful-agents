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
import https from 'node:https';

http.globalAgent = new http.Agent({ keepAlive: false });
https.globalAgent = new https.Agent({ keepAlive: false });
