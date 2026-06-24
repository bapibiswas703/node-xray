import type { Server as HttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express';
import type { XRayOptions, SnapshotSide } from '@node-xray/types';
import {
  createCore,
  redactHeaders,
  applyDashboardSecurityHeaders,
  type Core,
  type SerializedError,
} from '@node-xray/core';

const RECORD_ON_REQ = Symbol.for('@node-xray/express.record');
const RESPONSE_BODY_FLAG = Symbol.for('@node-xray/express.response-body');

/**
 * Resolve the absolute path to the `@node-xray/dashboard` assets
 * directory at runtime. We do NOT call `getAssetsDir()` from
 * `@node-xray/dashboard` because tsup inlines that function into
 * the consumer's dist, which breaks its `__filename` / `import.meta.url`
 * resolution. Instead, we use `require.resolve` (via `createRequire`
 * for ESM compatibility) to find the dashboard's `package.json`,
 * then navigate to the `assets/` sibling directory. This works in
 * both monorepo and `node_modules` layouts because `require.resolve`
 * uses Node's standard module resolution at runtime in THIS file's
 * context, not the dashboard's.
 */
function resolveDashboardAssetsDir(): string | null {
  const req = createRequire(import.meta.url);
  let mainEntry: string;
  try {
    mainEntry = req.resolve('@node-xray/dashboard');
  } catch {
    return null;
  }
  // The main entry resolves to one of:
  //   - `<pkg>/dist/index.cjs` (published CJS)
  //   - `<pkg>/dist/index.js`  (published ESM)
  //   - `<pkg>/src/index.ts`   (workspace source, via tsx)
  // In every case the assets directory is a sibling of the
  // immediate parent (i.e. `<pkg>/assets/`). We cannot use
  // `<pkg>/package.json` because the dashboard's `exports` field
  // does not allow it; the main entry is always reachable.
  return resolve(dirname(mainEntry), '..', 'assets');
}

/**
 * Cached dashboard assets. Loaded once on first request, then served
 * from memory. The assets are shipped by `@node-xray/dashboard`.
 */
let cachedIndexHtml: string | null = null;
function loadIndexHtml(dashboardPath: string, assetsDir: string | null): string {
  if (cachedIndexHtml !== null) return cachedIndexHtml;
  if (assetsDir === null) {
    cachedIndexHtml = PLACEHOLDER_HTML;
    return cachedIndexHtml;
  }
  try {
    const html = readFileSync(join(assetsDir, 'index.html'), 'utf-8');
    cachedIndexHtml = html
      .replace(/__STYLES__/g, encodeURI(`${dashboardPath}/styles.css`))
      .replace(/__APP__/g, encodeURI(`${dashboardPath}/app.js`));
    return cachedIndexHtml;
  } catch {
    cachedIndexHtml = PLACEHOLDER_HTML;
    return cachedIndexHtml;
  }
}

const PLACEHOLDER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>node-xray</title></head><body style="font-family:ui-monospace,monospace;background:#0d0f1a;color:#e2e8f0;padding:40px"><h1>node-xray dashboard not installed</h1><p>Install <code>@node-xray/dashboard</code> to enable the UI.</p></body></html>`;

/**
 * Public return value of `xray()`. The `RequestHandler` is what
 * `app.use()` consumes; `errorHandler` is a separate Express error
 * middleware that records the error before the response is sent.
 */
export interface XRayExpressHandle extends RequestHandler {
  /** The live `Core` instance, lazily created on the first request. */
  readonly core: Core;
  /** The fully resolved options (defaults applied, clamps applied). */
  readonly options: Core['options'];
  /**
   * Mount the dashboard and WebSocket on the given `http.Server`.
   * Idempotent: subsequent calls are a no-op. Called automatically the
   * first time a request reaches the middleware; you can also call it
   * explicitly (e.g. for tests) to ensure the dashboard is reachable
   * before any traffic.
   */
  mountDashboard(server: HttpServer): void;
  /**
   * Express error middleware. Register it AFTER all routes:
   *
   * ```ts
   * const x = xray();
   * app.use(x);
   * app.use(x.errorHandler);
   * ```
   *
   * It records the error on the in-flight record (if any) and re-throws
   * via `next(err)`.
   */
  readonly errorHandler: ErrorRequestHandler;
  /**
   * Read the store. Exposed for tests and for custom sinks that need
   * to subscribe to the buffer.
   */
  readonly store: Core['store'];
}

/**
 * Install `node-xray` on an Express app. One line:
 *
 * ```ts
 * import express from 'express';
 * import { xray } from '@node-xray/express';
 *
 * const app = express();
 * app.use(express.json());   // body parsers FIRST
 * app.use(xray());          // xray AFTER body parsers
 *
 * app.listen(3000);
 * // Dashboard: http://localhost:3000/node-xray
 * // WebSocket: ws://localhost:3000/node-xray/ws
 * ```
 *
 * The middleware:
 *
 *  1. Creates a `Core` lazily on the first request.
 *  2. Auto-mounts the dashboard and the WebSocket on the http.Server
 *     it captures from `req.socket.server`.
 *  3. Snapshots the request body (parsed body if `express.json()` ran
 *     upstream, otherwise the raw stream) and the response payload
 *     (intercepted at `res.json` / `res.send` / `res.write` / `res.end`).
 *  4. Finalizes the record on `res.finish` (or `res.close` if the
 *     connection drops mid-response).
 *  5. Honors the `ignore` predicate and the global redaction config.
 *
 * Throws `XRayConfigError` at registration time if the configuration
 * is invalid (e.g. conflicting `path`, missing `auth` in production).
 */
export function xray(options: XRayOptions = {}): XRayExpressHandle {
  const core = createCore(options);

  // Resolve the dashboard assets directory ONCE at registration time.
  // See `resolveDashboardAssetsDir` for why we do this here instead
  // of calling `getAssetsDir()` from `@node-xray/dashboard`.
  const assetsDir = resolveDashboardAssetsDir();

  let dashboardMounted = false;
  let mountTarget: HttpServer | null = null;

  const tryMountDashboard = (server: HttpServer | undefined | null): void => {
    if (dashboardMounted) return;
    if (!server) return;
    if (mountTarget && mountTarget !== server) {
      throw new Error(
        '[node-xray] dashboard already bound to a different http.Server. ' +
          'Create a new xray() instance per server.',
      );
    }
    mountTarget = server;
    try {
      if (assetsDir !== null) {
        core.mount(server, { assetsDir });
      } else {
        core.mount(server);
      }
      dashboardMounted = true;
    } catch (err) {
      core.options.onError(err instanceof Error ? err : new Error(String(err)), undefined);
    }
  };

  const handler: RequestHandler = function xrayMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    // 1. Serve the dashboard HTML if the path matches. This is done
    //    here (and not in the http.Server's 'request' listener) so
    //    we run before Express's 404 handler. The HTML is read from
    //    `@node-xray/dashboard`'s `assets/` directory on first hit.
    const dashboardPath = core.options.path;
    if (req.path === dashboardPath || req.path === `${dashboardPath}/`) {
      const html = loadIndexHtml(dashboardPath, assetsDir);
      applyDashboardSecurityHeaders(res);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'no-cache');
      res.statusCode = 200;
      res.end(html);
      // The http.Server's 'request' listener (added later by
      // `core.mount()`) also tries to handle this path. Neutralize
      // its ability to write so it doesn't throw ERR_HTTP_HEADERS_SENT.
      res.setHeader = (): Response => res;
      res.end = (): Response => res;
      // Make sure the core's listener is registered so the static
      // assets (app.js, styles.css) are served for subsequent
      // requests. Without this, the first request to the dashboard
      // would short-circuit here and the listener would never be
      // added.
      const server = (req.socket as unknown as { server?: HttpServer })?.server;
      if (!dashboardMounted) {
        tryMountDashboard(server);
      }
      return;
    }
    if (req.path === `${dashboardPath}/ws`) {
      // The WebSocket endpoint is served by the 'upgrade' listener.
      // A plain HTTP request to /ws should get 426 Upgrade Required.
      res.statusCode = 426;
      res.setHeader('Connection', 'close');
      res.end('Upgrade Required');
      return;
    }

    // 2. Skip ignored paths without touching the store.
    if (core.options.ignore({ path: req.path, method: req.method })) {
      next();
      return;
    }

    // 3. Mount the WebSocket hub on the http.Server we belong to.
    const server = (req.socket as unknown as { server?: HttpServer })?.server;
    if (!dashboardMounted) {
      tryMountDashboard(server);
    }

    // 4. Build the request snapshot (headers + parsed body if any).
    const request: SnapshotSide = {
      headers: redactHeaders(
        req.headers as Record<string, string | string[] | undefined>,
        core.options.redactHeaders,
      ),
    };
    if (core.options.captureRequestBody) {
      const body = (req as Request & { body?: unknown }).body;
      if (
        body !== undefined &&
        body !== null &&
        body !== '' &&
        !(typeof body === 'object' && Object.keys(body).length === 0)
      ) {
        request.body = body;
      }
    }

    // 5. Start the record.
    let record: ReturnType<Core['internals']['startRequest']>;
    try {
      record = core.internals.startRequest({
        id: generateRequestId(),
        method: req.method.toLowerCase(),
        path: req.path,
        framework: 'express',
        request,
      });
    } catch (err) {
      core.options.onError(err instanceof Error ? err : new Error(String(err)), undefined);
      next();
      return;
    }

    // Stash the record on the request so the error handler can find it.
    (req as Request & { [RECORD_ON_REQ]?: typeof record })[RECORD_ON_REQ] = record;

    // 6. Capture the matched route. Express sets req.route when the
    //    route is matched (before the handler runs). We capture it
    //    on res 'finish' (after the route handler has run) and
    //    include it in the final record at finalize time.
    const readRoute = (): string | undefined => {
      if (req.route?.path && typeof req.route.path === 'string') {
        const base = (req as Request & { baseUrl?: string }).baseUrl;
        return base ? `${base}${req.route.path}` : req.route.path;
      }
      return undefined;
    };

    // 7. Wrap the response so we can capture the body.
    wrapResponse(res, core, record, (payload) => {
      try {
        // Read the route NOW (after the handler has run, before
        // the 'finish' listener fires) and include it in the
        // final record. The wrapResponse's finalizeOnce invokes
        // this callback before store.finish is called, so the
        // route makes it into the final record.
        const route = readRoute();
        // The error handler may have stashed an error on the record.
        const stashed = (record as RequestRecordWithError).__xrayError;
        const captured = payload.error
          ? payload.error
          : stashed !== undefined
            ? serializeError(stashed)
            : undefined;

        const finalizeArg: Parameters<Core['internals']['finishRequest']>[0] = {
          record: route ? { ...record, route } : record,
          status: payload.status,
          response: payload.response,
          durationMs: payload.durationMs,
        };
        if (captured) finalizeArg.error = captured;
        core.internals.finishRequest(finalizeArg);
      } catch (err) {
        core.options.onError(err instanceof Error ? err : new Error(String(err)), record);
      }
    });

    next();
  };

  const handle = handler as XRayExpressHandle;

  const errorHandler: ErrorRequestHandler = (
    err,
    _req: Request,
    _res: Response,
    next: NextFunction,
  ): void => {
    const record = (
      _req as Request & { [RECORD_ON_REQ]?: ReturnType<Core['internals']['startRequest']> }
    )[RECORD_ON_REQ];
    if (record) {
      // Patch the in-flight record with the error. The wrapResponse
      // 'finish' handler will read this and attach it to the
      // final record at finalize time.
      (record as RequestRecordWithError).__xrayError = err;
    }
    next(err);
  };

  Object.defineProperties(handle, {
    core: { enumerable: true, get: () => core },
    options: { enumerable: true, get: () => core.options },
    store: { enumerable: true, get: () => core.store },
    mountDashboard: {
      enumerable: true,
      value: (server: HttpServer) => tryMountDashboard(server),
    },
    errorHandler: { enumerable: true, value: errorHandler },
  });

  return handle;
}

interface RequestRecordWithError {
  __xrayError?: unknown;
}

// --- internals --------------------------------------------------------------

interface ResponseCapture {
  jsonPayload: unknown;
  stringPayload: string | undefined;
  chunks: Buffer[];
  bufferBytes: number;
}

function wrapResponse(
  res: Response,
  core: Core,
  _record: ReturnType<Core['internals']['startRequest']>,
  finalize: (payload: {
    status: number;
    response: SnapshotSide;
    durationMs: number;
    error?: SerializedError;
  }) => void,
): void {
  const capture: ResponseCapture = {
    jsonPayload: undefined,
    stringPayload: undefined,
    chunks: [],
    bufferBytes: 0,
  };
  (res as Response & { [RESPONSE_BODY_FLAG]?: ResponseCapture })[RESPONSE_BODY_FLAG] = capture;

  const startedAtNs = process.hrtime.bigint();
  let finalized = false;

  const finalizeOnce = (error?: unknown): void => {
    if (finalized) return;
    finalized = true;
    const durationNs = process.hrtime.bigint() - startedAtNs;
    const durationMs = Number(durationNs) / 1e6;

    const response: SnapshotSide = {
      headers: redactHeaders(
        res.getHeaders() as Record<string, string | string[] | undefined>,
        core.options.redactHeaders,
      ),
    };
    if (core.options.captureResponseBody) {
      if (capture.jsonPayload !== undefined) {
        response.body = capture.jsonPayload;
      } else if (capture.stringPayload !== undefined) {
        response.body = capture.stringPayload;
      } else if (capture.chunks.length > 0) {
        const buf = Buffer.concat(capture.chunks);
        const asString = buf.toString('utf-8');
        // eslint-disable-next-line no-control-regex
        const isText = /^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]*$/.test(asString);
        response.body = isText ? asString : { __binary: true, base64: buf.toString('base64') };
      }
    }

    const capturedError = error !== undefined ? serializeError(error) : undefined;
    const arg: {
      status: number;
      response: SnapshotSide;
      durationMs: number;
      error?: SerializedError;
    } = {
      status: res.statusCode || 0,
      response,
      durationMs,
    };
    if (capturedError) arg.error = capturedError;
    finalize(arg);
  };

  // res.json: capture the payload, delegate to the original.
  const originalJson = res.json.bind(res) as Response['json'];
  res.json = ((payload: unknown) => {
    capture.jsonPayload = payload;
    capture.stringPayload = undefined;
    return originalJson(payload);
  }) as Response['json'];

  // res.send: capture string / buffer / object, delegate.
  const originalSend = res.send.bind(res) as Response['send'];
  res.send = ((payload?: unknown) => {
    if (payload === undefined || payload === null) {
      // Nothing to capture.
    } else if (typeof payload === 'string') {
      capture.stringPayload = payload;
    } else if (Buffer.isBuffer(payload)) {
      if (capture.bufferBytes + payload.length <= core.options.maxBodySize) {
        capture.chunks.push(payload);
        capture.bufferBytes += payload.length;
      }
    } else if (typeof payload === 'object') {
      capture.jsonPayload = payload;
    } else {
      capture.stringPayload = String(payload);
    }
    return originalSend(payload as Parameters<Response['send']>[0]);
  }) as Response['send'];

  // res.write: append chunk for streaming responses.
  const originalWrite = res.write.bind(res) as Response['write'];
  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (chunk !== undefined && chunk !== null) {
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(typeof chunk === 'string' ? chunk : String(chunk));
      if (capture.bufferBytes + buf.length <= core.options.maxBodySize) {
        capture.chunks.push(buf);
        capture.bufferBytes += buf.length;
      } else if (capture.bufferBytes < core.options.maxBodySize) {
        // Final partial chunk to hit the cap exactly once.
        const remaining = core.options.maxBodySize - capture.bufferBytes;
        capture.chunks.push(buf.subarray(0, remaining));
        capture.bufferBytes = core.options.maxBodySize;
      }
    }
    // The second arg can be encoding or callback depending on overloads.
    return (originalWrite as unknown as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as Response['write'];

  // res.end: append the optional final chunk and finalize.
  const originalEnd = res.end.bind(res) as Response['end'];
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (chunk !== undefined && chunk !== null) {
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(typeof chunk === 'string' ? chunk : String(chunk));
      if (capture.bufferBytes + buf.length <= core.options.maxBodySize) {
        capture.chunks.push(buf);
        capture.bufferBytes += buf.length;
      } else if (capture.bufferBytes < core.options.maxBodySize) {
        const remaining = core.options.maxBodySize - capture.bufferBytes;
        capture.chunks.push(buf.subarray(0, remaining));
        capture.bufferBytes = core.options.maxBodySize;
      }
    }
    const result = (originalEnd as unknown as (...a: unknown[]) => Response)(chunk, ...rest);
    finalizeOnce();
    return result;
  }) as Response['end'];

  // Express error middleware: when `next(err)` is called, Express
  // waits for an error handler. The status will only be set there.
  res.on('finish', () => finalizeOnce());
  res.on('close', () => finalizeOnce());
}

let requestCounter = 0;
function generateRequestId(): string {
  // Monotonic-ish ULID-ish id. Enough for v1.
  const time = Date.now().toString(36);
  const counter = (requestCounter++).toString(36).padStart(4, '0');
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, '0');
  return `req_${time}${counter}${rand}`;
}

function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      ...(err.stack ? { stack: err.stack } : {}),
    };
  }
  return { name: 'Error', message: String(err) };
}

// --- public type re-exports -----------------------------------------------

export type { XRayOptions } from '@node-xray/types';
export type { XRayContext } from '@node-xray/types';
export type { RequestRecord } from '@node-xray/types';
