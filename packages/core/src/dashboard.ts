import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import type { XRayAuth, XRayAuthRequest } from '@node-xray/types';
import { XRayConfigError } from './errors.js';

export interface MountOptions {
  path: string;
  auth?: XRayAuth;
  /**
   * Absolute path to the dashboard assets directory. The directory
   * must contain `index.html`, `app.js`, and `styles.css`. When
   * omitted, the dashboard route returns a 503 placeholder.
   */
  assetsDir?: string;
  /** Allow origins for the WebSocket upgrade. Defaults to same-host. */
  allowOrigins?: readonly string[] | 'all' | 'same-host';
  /**
   * Sink for unexpected internal errors (e.g. a custom auth
   * `verify` that threw). Defaults to `console.error` with a
   * `[node-xray]` prefix. Must not throw.
   */
  onError?: (err: Error, ctx: unknown) => void;
}

const DEFAULT_ON_ERROR = (err: Error): void => {
  console.error('[node-xray]', err.message, err.stack);
};

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>node-xray</title>
  </head>
  <body style="font-family: ui-monospace, monospace; background: #0d0f1a; color: #e2e8f0; padding: 40px;">
    <h1 style="color: #a78bfa; font-size: 16px;">node-xray dashboard not installed</h1>
    <p style="margin-top: 12px; color: #94a3b8;">
      Install the <code>@node-xray/dashboard</code> package to enable the live UI at
      <code>__PATH__/</code>.
    </p>
  </body>
</html>
`;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

interface AssetCache {
  indexHtml: string;
  appJs: string;
  stylesCss: string;
}

/**
 * Mount the dashboard route and the WebSocket endpoint on an HTTP
 * server. Adapters call this; user code rarely needs to.
 *
 * The dashboard HTML / JS / CSS are loaded once (synchronously, so
 * the first request is never raced) from `<assetsDir>/` (provided by
 * the adapter, which resolves it through `@node-xray/dashboard`) and
 * served from memory. The `app.js` script opens a WebSocket back to
 * `<path>/ws` and renders the wire protocol.
 */
export function mountDashboard(
  server: HttpServer,
  attach: (server: HttpServer) => void,
  options: MountOptions,
): void {
  const path = normalizePath(options.path);
  const assetsDir = options.assetsDir;
  const hasAssets = typeof assetsDir === 'string' && assetsDir.length > 0;

  // Load the three primary assets synchronously so the first request
  // is never raced. If loading fails (e.g. dashboard package not
  // installed), the route falls back to the placeholder HTML.
  let cached: AssetCache | null = null;
  if (hasAssets) {
    try {
      cached = loadAssets(assetsDir);
    } catch {
      cached = null;
    }
  }

  // Auth check helper used by every dashboard route. On a positive
  // result the response headers are set and `true` is returned;
  // on a negative result the response is short-circuited with a
  // 401/500 and `false` is returned. Exceptions from a custom
  // `verify` are funneled through `onError` and translated into a
  // 500 — never propagated as unhandled rejections.
  const onError = options.onError ?? DEFAULT_ON_ERROR;
  const authorize = async (
    req: IncomingMessage,
    _res: ServerResponse,
    sendStatus: (code: number, body: string) => void,
  ): Promise<boolean> => {
    if (!options.auth) return true;
    try {
      const ok = await runAuth(req, options.auth);
      if (ok) return true;
      sendStatus(401, 'Unauthorized');
      return false;
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)), {
        url: req.url ?? '/',
        method: req.method ?? 'GET',
      });
      sendStatus(500, 'Internal Server Error');
      return false;
    }
  };

  // Capture the onError once so each handler doesn't reach into
  // `options` again (keeps the type narrowing straightforward).
  const reportError = onError;

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    if (!req.url) return;
    const url = req.url.split('?')[0] ?? '';

    // Root + canonical index: serve the SPA shell.
    if (url === path || url === `${path}/` || url === `${path}/index.html`) {
      const noAuth = !options.auth;
      const sendHtml = (): void => {
        const html = cached ? replaceTokens(cached.indexHtml, path) : placeholderFor(path);
        applySecurityHeaders(res, hasAssets && cached !== null);
        res.statusCode = cached ? 200 : 503;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        res.end(html);
      };
      if (noAuth) {
        sendHtml();
        return;
      }
      void authorize(req, res, (code, body) => {
        res.statusCode = code;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.setHeader('www-authenticate', 'Basic realm="node-xray"');
        res.end(body);
      }).then((ok) => {
        if (ok) sendHtml();
      });
      return;
    }

    // Primary static assets — also require auth so the JS / CSS
    // are not served to anonymous clients.
    if (
      url === `${path}/app.js` ||
      url === `${path}/styles.css` ||
      url.startsWith(`${path}/assets/`)
    ) {
      const rel =
        url === `${path}/app.js`
          ? 'app.js'
          : url === `${path}/styles.css`
            ? 'styles.css'
            : url.slice(`${path}/assets/`.length);
      void authorize(req, res, (code, body) => {
        res.statusCode = code;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(body);
      }).then((ok) => {
        if (!ok) return;
        sendAsset(res, assetsDir, rel);
      });
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
        // Funnel unexpected errors through the configured onError so
        // they surface in observability without crashing the process
        // or leaking an unhandled rejection.
        reportError(err instanceof Error ? err : new Error(String(err)), {
          url: req.url ?? '/',
          method: req.method ?? 'GET',
        });
        try {
          socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
          socket.destroy();
        } catch {
          // The socket may already be destroyed; swallow.
        }
      }
    })();
  });
}

function loadAssets(dir: string): AssetCache {
  return {
    indexHtml: readFileSync(resolve(dir, 'index.html'), 'utf-8'),
    appJs: readFileSync(resolve(dir, 'app.js'), 'utf-8'),
    stylesCss: readFileSync(resolve(dir, 'styles.css'), 'utf-8'),
  };
}

function replaceTokens(html: string, path: string): string {
  return html
    .replace(/__STYLES__/g, encodeURI(`${path}/styles.css`))
    .replace(/__APP__/g, encodeURI(`${path}/app.js`));
}

function placeholderFor(path: string): string {
  return PLACEHOLDER_HTML.replace(/__PATH__/g, encodeURI(path));
}

function sendAsset(res: ServerResponse, dir: string | undefined, rel: string): void {
  if (!dir) {
    res.statusCode = 503;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('dashboard assets not installed');
    return;
  }
  // Sanitize: no `..`, no leading `/`.
  if (rel.includes('..') || rel.startsWith('/') || rel.includes('\\')) {
    res.statusCode = 400;
    res.end('bad request');
    return;
  }
  const filePath = resolve(dir, rel);
  if (!filePath.startsWith(resolve(dir))) {
    res.statusCode = 400;
    res.end('bad request');
    return;
  }
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const body = readFileSync(filePath);
    res.statusCode = 200;
    const ext = extname(filePath);
    res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('cache-control', 'public, max-age=0, must-revalidate');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('not found');
  }
}

/**
 * Single source of truth for the security headers that every
 * dashboard HTML response must set. Adapters call this so the
 * CSP / X-Content-Type-Options / Referrer-Policy are consistent
 * across Express, Fastify, NestJS, and the core's own listener.
 *
 * The CSP allows:
 *  - `script-src 'self'`: the dashboard loads `app.js` from the
 *    same origin. No inline scripts, no eval, no third-party JS.
 *  - `style-src 'self' 'unsafe-inline'`: the dashboard uses inline
 *    `style="…"` attributes on dynamically-created nodes for
 *    progress bars and color hints. The stylesheet itself comes
 *    from the same origin.
 *  - `connect-src 'self' ws: wss:`: the WebSocket client opens
 *    back to the same origin.
 *  - `img-src 'self' data:`: placeholder avatars / status icons
 *    may be inline `data:` URIs.
 *  - `default-src 'self'`: everything else must come from the
 *    same origin.
 *  - `form-action 'none'`, `base-uri 'none'`,
 *    `frame-ancestors 'none'`: belt-and-braces; the dashboard
 *    has no forms, no <base>, and must never be embeddable.
 */
export function applyDashboardSecurityHeaders(res: ServerResponse): void {
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
}

function applySecurityHeaders(res: ServerResponse, strict: boolean): void {
  if (!strict) return;
  applyDashboardSecurityHeaders(res);
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

function normalizePath(p: string): string {
  if (!p.startsWith('/')) {
    throw new XRayConfigError(`path must start with '/'. Got '${p}'.`);
  }
  return p.replace(/\/+$/, '') || '/';
}
