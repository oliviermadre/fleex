import { createServer } from 'node:http';

import type { FastifyServerFactory } from 'fastify';

/**
 * Node counts the request line (i.e. the full URL) towards `maxHeaderSize`, and
 * llhttp rejects the connection with `431 Request Header Fields Too Large`
 * before any Fastify handler runs — no route, no error hook, empty body. The
 * 16 KB default was reached at ~425 tickets by the bulk ticket endpoints (#509).
 *
 * Those two endpoints now POST their IDs in the body, which is the actual fix.
 * This raised ceiling is a guard-rail for the endpoints that still serialize
 * arrays into the query string (`?branches=`, `?repos=`).
 *
 * Fastify v5 has no `maxHeaderSize` option, hence the explicit server factory —
 * which also keeps the setting on every launch path (Electron desktop,
 * `node dist/main.js`), unlike a `--max-http-header-size` CLI flag.
 */
export const MAX_HEADER_SIZE = 64 * 1024;

export const fleexServerFactory: FastifyServerFactory = (handler) =>
  createServer({ maxHeaderSize: MAX_HEADER_SIZE }, handler);
