import {
  Inject,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { tap, catchError, throwError, EMPTY, type Observable } from 'rxjs';
import type { Core, SerializedError } from '@node-xray/core';
import { redactHeaders, redactSnapshot } from '@node-xray/core';
import type { XRayRequest, XRayResponse } from './types.js';
import { XRAY_REQUEST_KEY, XRAY_RESPONSE_KEY } from './symbols.js';
import { XRAY_CORE } from './service.js';

const DASHBOARD_MOUNTED = Symbol.for('@node-xray/nestjs.dashboard-mounted');
const SERVER_LOCK = Symbol.for('@node-xray/nestjs.server-lock');

void DASHBOARD_MOUNTED; // Reserved for cross-app guards (unused in v1).

interface RequestRecordWithError {
  __xrayError?: unknown;
}

/**
 * Global NestJS HTTP interceptor. Captures every request that
 * passes through Nest's pipeline:
 *
 *  1. Reads the request body and headers.
 *  2. Starts a `RequestRecord` on the `Core`.
 *  3. Mounts the dashboard on the underlying http.Server the first
 *     time a request arrives (works on both Express and Fastify).
 *  4. Observes the response observable; on next, records the
 *     response body, headers, and status. On error, records the
 *     error on the in-flight record.
 */
export class XrayInterceptor implements NestInterceptor {
  constructor(@Inject(XRAY_CORE) private readonly core: Core) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.core.options.enabled) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<XRayRequest & { socket?: { server?: unknown } }>();
    const response = http.getResponse<DashboardResponse>();

    const method = (request.method ?? 'GET').toLowerCase();
    const path = request.path ?? request.url ?? '/';
    const dashboardPath = this.core.options.path;

    // Handle the dashboard path directly. The dashboard's `request`
    // listener is added lazily on the first request, but the first
    // request is in flight, so it would otherwise miss the listener
    // and reach the user's 404 handler. Responding here mirrors the
    // Express adapter's behavior.
    const requestPath = (request.url ?? request.path ?? '').split('?')[0] ?? '';
    if (
      (method === 'get' || method === 'head') &&
      (requestPath === dashboardPath || requestPath === `${dashboardPath}/`)
    ) {
      // Trigger the prepend-based listener mount; the listener will
      // respond to this and any subsequent request to the dashboard.
      this.maybeMountDashboard(request);
      // If the prepend listener didn't respond (e.g. fastify raw
      // server), fall back to responding inline.
      if (response.statusCode !== 200) {
        respondDashboard(response as unknown as DashboardResponse, dashboardPath);
      }
      return EMPTY;
    }

    // Lazily mount the dashboard on the underlying http.Server. We
    // do this on the first request because the server isn't known
    // at module-register time. We do it before the ignore check so
    // that a request to the dashboard path itself triggers the mount.
    this.maybeMountDashboard(request);

    // Honor the ignore predicate.
    if (this.core.options.ignore({ path, method })) {
      return next.handle();
    }

    // Build the request snapshot.
    const snapshot: {
      headers: Record<string, string>;
      body?: unknown;
    } = {
      headers: redactHeaders(
        (request.headers ?? {}) as Record<string, string | string[] | undefined>,
        this.core.options.redactHeaders,
      ),
    };
    if (
      this.core.options.captureRequestBody &&
      request.body !== undefined &&
      request.body !== null &&
      request.body !== '' &&
      !(typeof request.body === 'object' && Object.keys(request.body).length === 0)
    ) {
      snapshot.body = redactSnapshot(
        request.body,
        this.core.options.redactBodyPaths,
        this.core.options.maxBodySize,
      );
    }

    // Derive the route pattern from either Express's `req.route.path`
    // (set by Express routing) or Nest's class+method metadata.
    const route = this.deriveRoute(context, request);

    let record;
    try {
      record = this.core.internals.startRequest({
        id: generateRequestId(),
        method,
        path,
        ...(route ? { route } : {}),
        framework: 'nestjs',
        request: snapshot,
      });
    } catch (err) {
      this.core.options.onError(err instanceof Error ? err : new Error(String(err)), undefined);
      return next.handle();
    }

    // Stash the record on the request so the response/error paths
    // can find it without a closure.
    (request as XRayRequest & { [XRAY_REQUEST_KEY]?: typeof record })[XRAY_REQUEST_KEY] = record;

    return next.handle().pipe(
      tap((body) => {
        // Capture the response body (the value emitted by the handler).
        if (body !== undefined && this.core.options.captureResponseBody) {
          (response as XRayResponse & { [XRAY_RESPONSE_KEY]?: unknown })[XRAY_RESPONSE_KEY] = body;
        }
      }),
      tap({
        next: () => {
          // Defer so NestJS's exception filter has time to write the
          // response (and thus set statusCode) before we read it.
          setTimeout(() => this.finalize(request, response, undefined), 0);
        },
        error: (err: unknown) => {
          setTimeout(() => this.finalize(request, response, err), 0);
        },
      }),
      catchError((err: unknown) => throwError(() => err)),
    );
  }

  private maybeMountDashboard(request: XRayRequest & { socket?: { server?: unknown } }): void {
    // Per-core flag so that multiple apps (e.g. in tests) each get
    // their own dashboard mount on their own server.
    const coreRef = this.core as Core & { [SERVER_LOCK]?: boolean };
    if (coreRef[SERVER_LOCK]) return;

    const candidates: unknown[] = [request.raw?.socket?.server, request.socket?.server];

    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object' && 'on' in (candidate as object)) {
        const server = candidate as Parameters<Core['mount']>[0];

        // Prepend a listener that handles the dashboard path BEFORE
        // Express processes the request. The core's `mount()` adds a
        // listener via `server.on(...)` (appended to the end), but in
        // a NestJS app Express is the first 'request' listener and
        // would otherwise send a 404 before our listener runs.
        //
        // We also patch `res.setHeader` to a no-op when we've handled
        // the response, so the core's appended listener (added by
        // `mount()`) doesn't throw `ERR_HTTP_HEADERS_SENT` when it
        // tries to set its own headers on an already-sent response.
        const dashboardPath = this.core.options.path;
        const prependListener = (
          server as unknown as {
            prependListener?: (event: string, listener: (...args: unknown[]) => void) => void;
          }
        ).prependListener;
        if (typeof prependListener === 'function') {
          prependListener.call(server, 'request', ((
            req: { url?: string },
            res: {
              setHeader?: (n: string, v: string) => void;
              set?: (n: string, v: string) => void;
              statusCode: number;
              end?: (chunk?: string) => void;
              send?: (body?: string) => void;
              headersSent?: boolean;
            },
          ) => {
            const url = (req.url ?? '').split('?')[0] ?? '';
            if (url !== dashboardPath && url !== `${dashboardPath}/`) return;
            if (res.statusCode === 404) res.statusCode = 200;
            const setHeader = (n: string, v: string): void => {
              if (res.setHeader) {
                res.setHeader(n, v);
              } else {
                res.set?.(n, v);
              }
            };
            setHeader('content-type', 'text/html; charset=utf-8');
            setHeader('cache-control', 'no-cache');
            setHeader(
              'content-security-policy',
              "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'",
            );
            setHeader('x-content-type-options', 'nosniff');
            setHeader('referrer-policy', 'no-referrer');
            if (res.send) {
              res.send(DASHBOARD_HTML.replace(/__PATH__/g, encodeURI(dashboardPath)));
            } else {
              res.end?.(DASHBOARD_HTML.replace(/__PATH__/g, encodeURI(dashboardPath)));
            }
            // Neutralize further header writes and end() so the
            // core's appended listener (added by `core.mount()`)
            // does not throw when it tries to set its own headers
            // or end the response.
            res.setHeader = (): void => {};
            res.end = (): void => {};
          }) as (...args: unknown[]) => void);
        }

        try {
          this.core.mount(server);
          coreRef[SERVER_LOCK] = true;
        } catch (err) {
          this.core.options.onError(err instanceof Error ? err : new Error(String(err)), undefined);
        }
        return;
      }
    }
  }

  private deriveRoute(context: ExecutionContext, request: XRayRequest): string | undefined {
    // Express sets `request.route.path` after the router matches.
    const expressRoute = request.route;
    if (typeof expressRoute === 'string' && expressRoute.length > 0) {
      return expressRoute;
    }
    if (expressRoute && typeof expressRoute === 'object') {
      const p = (expressRoute as { path?: string }).path;
      if (typeof p === 'string' && p.length > 0) {
        return p;
      }
    }

    // Fall back to Nest's class+method names.
    const className = context.getClass()?.name;
    const handlerName = context.getHandler()?.name;
    if (className && handlerName) {
      return `${className}.${handlerName}`;
    }
    return undefined;
  }

  private finalize(
    request: XRayRequest & { [XRAY_REQUEST_KEY]?: unknown },
    response: DashboardResponse,
    error: unknown,
  ): void {
    const record = request[XRAY_REQUEST_KEY] as
      | ReturnType<Core['internals']['startRequest']>
      | undefined;
    if (!record) return;

    const responseSnapshot: {
      headers: Record<string, string>;
      body?: unknown;
    } = {
      headers: redactHeaders(
        (response.headers ?? {}) as Record<string, string | string[] | undefined>,
        this.core.options.redactHeaders,
      ),
    };
    if (this.core.options.captureResponseBody) {
      const stored = (response as XRayResponse & { [XRAY_RESPONSE_KEY]?: unknown })[
        XRAY_RESPONSE_KEY
      ];
      if (stored !== undefined) {
        responseSnapshot.body = redactSnapshot(
          stored,
          this.core.options.redactBodyPaths,
          this.core.options.maxBodySize,
        );
      }
    }

    const captured: SerializedError | undefined =
      error !== undefined
        ? error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              ...(error.stack ? { stack: error.stack } : {}),
            }
          : { name: 'Error', message: String(error) }
        : (record as RequestRecordWithError).__xrayError
          ? serializeError((record as RequestRecordWithError).__xrayError!)
          : undefined;

    const arg: Parameters<Core['internals']['finishRequest']>[0] = {
      record,
      status: response.statusCode,
      response: responseSnapshot,
      durationMs: 0, // NestJS doesn't expose hr-time on the response; we accept 0 in v1.
    };
    if (captured) arg.error = captured;
    try {
      this.core.internals.finishRequest(arg);
    } catch (err) {
      this.core.options.onError(err instanceof Error ? err : new Error(String(err)), record);
    }
  }
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

type DashboardResponse = XRayResponse & {
  statusCode: number;
  setHeader?: (name: string, value: string) => void;
  set?: (name: string, value: string) => void;
  end?: (chunk?: string) => void;
  send?: (body?: string) => void;
};

function respondDashboard(response: DashboardResponse, path: string): void {
  const html = DASHBOARD_HTML.replace(/__PATH__/g, encodeURI(path));
  const setHeader = (name: string, value: string): void => {
    if (response.setHeader) {
      response.setHeader(name, value);
    } else {
      response.set?.(name, value);
    }
  };
  setHeader('content-type', 'text/html; charset=utf-8');
  setHeader('cache-control', 'no-cache');
  setHeader(
    'content-security-policy',
    "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'",
  );
  setHeader('x-content-type-options', 'nosniff');
  setHeader('referrer-policy', 'no-referrer');
  response.statusCode = 200;
  // Prefer Express-style `.send()` (handles 304, content-length, etc.);
  // fall back to raw `end()` for Fastify's raw response.
  if (response.send) {
    response.send(html);
  } else if (response.end) {
    response.end(html);
  }
}

let requestCounter = 0;
function generateRequestId(): string {
  const time = Date.now().toString(36);
  const counter = (requestCounter++).toString(36).padStart(4, '0');
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, '0');
  return `req_${time}${counter}${rand}`;
}

/**
 * Re-export the `XRAY_REQUEST_KEY` and `XRAY_RESPONSE_KEY` symbols
 * for the module-level wiring.
 */
export { XRAY_REQUEST_KEY, XRAY_RESPONSE_KEY };
