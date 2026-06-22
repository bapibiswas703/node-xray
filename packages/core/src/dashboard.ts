import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';
import type { XRayAuth, XRayAuthRequest } from '@node-xray/types';
import { XRayConfigError } from './errors.js';

const STATIC_DIRNAME = join(dirname(fileURLToPath(import.meta.url)), 'assets');

export interface MountOptions {
  path: string;
  auth?: XRayAuth;
  /** Override the static assets directory. Test-only. */
  assetsDir?: string;
  /** Allow origins for the WebSocket upgrade. Defaults to same-host. */
  allowOrigins?: readonly string[] | 'all' | 'same-host';
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>node-xray</title>
    <meta http-equiv="refresh" content="0; url=__PATH__/" />
  </head>
  <body>
    <p>node-xray dashboard. Redirecting to <a href="__PATH__/">the dashboard</a>.</p>
  </body>
</html>
`;

/**
 * Mount the dashboard route and the WebSocket endpoint on an HTTP
 * server. Adapters call this; user code rarely needs to.
 *
 * The dashboard assets are not yet shipped in P1; P5 will replace the
 * inline redirect with the v4.1 UI. The HTTP routes and the WebSocket
 * contract are final.
 */
export function mountDashboard(
  server: HttpServer,
  attach: (server: HttpServer) => void,
  options: MountOptions,
): void {
  const path = normalizePath(options.path);

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    if (!req.url) return;
    const url = req.url.split('?')[0] ?? '';

    if (url === path || url === `${path}/`) {
      const html = DASHBOARD_HTML.replace(/__PATH__/g, encodeURI(path));
      applySecurityHeaders(res);
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'no-cache');
      res.end(html);
      return;
    }

    if (url === `${path}/assets/index.html` || url === `${path}/index.html`) {
      // The static index is the same redirect. The real SPA is at /.
      const html = DASHBOARD_HTML.replace(/__PATH__/g, encodeURI(path));
      applySecurityHeaders(res);
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'no-cache');
      res.end(html);
      return;
    }

    if (url.startsWith(`${path}/assets/`)) {
      void serveStatic(req, res, options);
      return;
    }
  });

  // Auth + origin check happen at upgrade time, inside `attach`.
  attach(server);

  // Wrap the upgrade to enforce auth and origin. The hub's own upgrade
  // handler is responsible for the WS protocol. We add an origin guard
  // before that.
  const userAgentListeners = server.listeners('upgrade').slice();
  server.removeAllListeners('upgrade');
  server.on('upgrade', (req, socket: Duplex, head) => {
    if (!req.url?.startsWith(`${path}/ws`)) {
      // Not ours; replay to other listeners.
      for (const l of userAgentListeners) {
        (l as (req: IncomingMessage, socket: Duplex, head: Buffer) => void)(req, socket, head);
      }
      return;
    }

    void (async () => {
      try {
        if (!checkOrigin(req, options.allowOrigins)) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
        if (options.auth) {
          const ok = await runAuth(req, options.auth);
          if (!ok) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
        }
        for (const l of userAgentListeners) {
          (l as (req: IncomingMessage, socket: Duplex, head: Buffer) => void)(req, socket, head);
        }
      } catch (err) {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
        throw err;
      }
    })();
  });
}

function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'",
  );
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
}

function checkOrigin(
  req: IncomingMessage,
  allow: readonly string[] | 'all' | 'same-host' | undefined,
): boolean {
  if (allow === 'all') return true;
  const origin = req.headers['origin'];
  if (!origin) return true; // Same-origin requests omit Origin.
  if (allow === 'same-host' || allow === undefined) {
    const host = req.headers['host'];
    if (!host) return false;
    try {
      const u = new URL(origin);
      return u.host === host;
    } catch {
      return false;
    }
  }
  return allow.includes(origin);
}

async function runAuth(req: IncomingMessage, auth: XRayAuth): Promise<boolean> {
  const remoteAddress = req.socket?.remoteAddress;
  const normalized: XRayAuthRequest = {
    url: req.url ?? '/',
    method: (req.method ?? 'GET').toUpperCase(),
    headers: req.headers as Record<string, string | string[] | undefined>,
    ...(remoteAddress !== undefined ? { remoteAddress } : {}),
  };
  switch (auth.type) {
    case 'basic': {
      const header = req.headers['authorization'];
      if (!header) return false;
      const [scheme, value] = header.split(' ');
      if (scheme?.toLowerCase() !== 'basic' || !value) return false;
      const decoded = Buffer.from(value, 'base64').toString('utf-8');
      const i = decoded.indexOf(':');
      if (i === -1) return false;
      const user = decoded.slice(0, i);
      const pass = decoded.slice(i + 1);
      return constantTimeEqual(user, auth.user) && constantTimeEqual(pass, auth.pass);
    }
    case 'bearer': {
      const header = req.headers['authorization'];
      if (!header) return false;
      const [scheme, value] = header.split(' ');
      if (scheme?.toLowerCase() !== 'bearer' || !value) return false;
      return constantTimeEqual(value, auth.token);
    }
    case 'custom':
      return await auth.verify(normalized);
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function serveStatic(
  _req: IncomingMessage,
  res: ServerResponse,
  options: MountOptions,
): Promise<void> {
  applySecurityHeaders(res);
  const dir = options.assetsDir ?? STATIC_DIRNAME;
  const filePath = resolve(dir, 'index.html');
  try {
    const s = await stat(filePath);
    if (!s.isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const body = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=0, must-revalidate');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('not found');
  }
}

function normalizePath(p: string): string {
  if (!p.startsWith('/')) {
    throw new XRayConfigError(`path must start with '/'. Got '${p}'.`);
  }
  return p.replace(/\/+$/, '') || '/';
}
