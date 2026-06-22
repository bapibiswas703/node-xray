import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { XRayOptions, SnapshotSide } from '@node-xray/types';
import {
  createCore,
  redactHeaders,
  redactSnapshot,
  applyDashboardSecurityHeaders,
  type Core,
  type SerializedError,
} from '@node-xray/core';
import { getAssetsDir } from '@node-xray/dashboard';

const RECORD_ON_REQ = Symbol.for('@node-xray/fastify.record');
const RESPONSE_BODY_FLAG = Symbol.for('@node-xray/fastify.response-body');

/** Read the dashboard HTML from the `@node-xray/dashboard` package. */
function loadDashboardHtml(dashboardPath: string): string {
  try {
    const raw = readFileSync(join(getAssetsDir(), 'index.html'), 'utf-8');
    return raw
      .replace(/__STYLES__/g, encodeURI(`${dashboardPath}/styles.css`))
      .replace(/__APP__/g, encodeURI(`${dashboardPath}/app.js`));
  } catch {
    return `<!doctype html><html><head><meta charset="utf-8"><title>node-xray</title></head><body style="font-family:ui-monospace,monospace;background:#0d0f1a;color:#e2e8f0;padding:40px"><h1>node-xray dashboard not installed</h1><p>Install <code>@node-xray/dashboard</code> to enable the UI.</p></body></html>`;
  }
}

/**
 * Options for the Fastify plugin. In addition to the standard
 * `XRayOptions`, the plugin supports:
 *
 *  - `skipDashboard` — when `true`, the plugin does not register a
 *    route for the dashboard HTML. Useful when the plugin is
 *    encapsulated and the host app already mounts a different
 *    dashboard route.
 */
export interface XRayFastifyOptions extends XRayOptions {
  skipDashboard?: boolean;
}

/**
 * The plugin handle. The function itself is what `fastify.register()`
 * consumes; the side properties expose the live core for tests and
 * custom sinks.
 */
export interface XRayFastifyPlugin {
  (instance: FastifyInstance, opts: XRayFastifyOptions): Promise<void>;
  /** The live `Core` instance, created at register time. */
  readonly core: Core;
  /** The fully resolved options. */
  readonly options: Core['options'];
}

/**
 * Install `node-xray` on a Fastify instance. One line:
 *
 * ```ts
 * import Fastify from 'fastify';
 * import { xrayPlugin } from '@node-xray/fastify';
 *
 * const app = Fastify();
 * await app.register(xrayPlugin());
 *
 * app.get('/api/users', async () => ({ ok: true }));
 * await app.listen({ port: 3000 });
 * // Dashboard: http://localhost:3000/node-xray
 * // WebSocket: ws://localhost:3000/node-xray/ws
 * ```
 *
 * The plugin:
 *
 *  1. Creates a `Core` at register time.
 *  2. Auto-mounts the dashboard and WebSocket on the http.Server
 *     captured from `request.raw.socket.server`.
 *  3. Snapshots the parsed request body (after Fastify's body
 *     parser has populated `request.body`) and the response payload
 *     (read from the `onSend` hook, which Fastify hands us the
 *     serialized payload — no double-buffering).
 *  4. Finalizes the record on the `onResponse` hook.
 *  5. Captures errors via the `onError` hook (Fastify v5+) and
 *     a `setErrorHandler` fallback for v4.
 *  6. Honors the `ignore` predicate and the global redaction config.
 *
 * Throws `XRayConfigError` at register time if the configuration is
 * invalid (e.g. conflicting `path`, missing `auth` in production).
 */
export function xrayPlugin(options: XRayFastifyOptions = {}): XRayFastifyPlugin {
  const core = createCore(options);
  const path = core.options.path;
  const skipDashboard = options.skipDashboard === true;

  const pluginFn: FastifyPluginAsync<XRayFastifyOptions> = fp(
    async function xrayPluginFn(instance) {
      let dashboardMounted = false;
      let mountTarget: FastifyInstance['server'] | null = null;

      const tryMountDashboard = (server: FastifyInstance['server'] | undefined | null): void => {
        if (dashboardMounted) return;
        if (!server) return;
        if (mountTarget && mountTarget !== server) {
          throw new Error(
            '[node-xray] dashboard already bound to a different http.Server. ' +
              'Create a new xrayPlugin() instance per server.',
          );
        }
        mountTarget = server;
        try {
          core.mount(server, { assetsDir: getAssetsDir() });
          dashboardMounted = true;
        } catch (err) {
          core.options.onError(err instanceof Error ? err : new Error(String(err)), undefined);
        }
      };

      // Dashboard HTML route. Registered before any user routes so
      // it takes precedence over Fastify's 404 handler. The HTML is
      // read from `@node-xray/dashboard`'s `assets/` directory on
      // first hit and cached in memory.
      if (!skipDashboard) {
        const cachedHtml = loadDashboardHtml(path);
        instance.get(path, (_req, reply) => {
          applyDashboardSecurityHeaders(reply.raw);
          reply
            .header('cache-control', 'no-cache')
            .type('text/html; charset=utf-8')
            .send(cachedHtml);
        });
      }

      // Capture the request: build the snapshot and start the record.
      // Ignored paths skip this entirely. We do this in `onRequest` so
      // we have the route URL available via `request.routeOptions.url`.
      instance.addHook('onRequest', (request, _reply, done) => {
        // Capture the http.Server the first time we see a request.
        const server = (request.raw.socket as unknown as { server?: FastifyInstance['server'] })
          ?.server;
        if (server && !dashboardMounted) {
          tryMountDashboard(server);
        }

        if (core.options.ignore({ path: request.url, method: request.method })) {
          done();
          return;
        }

        let record;
        try {
          record = core.internals.startRequest({
            id: generateRequestId(),
            method: request.method,
            path: splitPath(request.url),
            ...(request.routeOptions?.url ? { route: request.routeOptions.url } : {}),
            framework: 'fastify',
            request: {
              headers: redactHeaders(
                request.headers as Record<string, string | string[] | undefined>,
                core.options.redactHeaders,
              ),
            },
          });
        } catch (err) {
          // Muted core (enabled: false) or other internal error. Log
          // and continue without recording.
          core.options.onError(err instanceof Error ? err : new Error(String(err)), undefined);
          done();
          return;
        }

        (request as FastifyRequest & { [RECORD_ON_REQ]?: typeof record })[RECORD_ON_REQ] = record;
        done();
      });

      // Capture the request body AFTER Fastify's body parser has
      // populated `request.body`. This is `preHandler`, which runs after
      // `preValidation` and `preParsing` (where the parser runs).
      // Apply the body redaction here so the dashboard sees the
      // sanitized form.
      instance.addHook('preHandler', (request, _reply, done) => {
        const record = (
          request as FastifyRequest & {
            [RECORD_ON_REQ]?: ReturnType<Core['internals']['startRequest']>;
          }
        )[RECORD_ON_REQ];
        if (!record) {
          done();
          return;
        }
        if (core.options.captureRequestBody && request.body !== undefined) {
          if (
            request.body !== null &&
            request.body !== '' &&
            !(typeof request.body === 'object' && Object.keys(request.body).length === 0)
          ) {
            const redactedBody = redactSnapshot(
              request.body,
              core.options.redactBodyPaths,
              core.options.maxBodySize,
            );
            try {
              // Mutate the in-memory record in place so finishRequest
              // sees the body. We bypass the store's update (which
              // creates a new object) and patch the live reference.
              (record as RequestRecordMutable).request = {
                headers: record.request.headers,
                body: redactedBody,
              };
            } catch {
              // Ignore: body capture is best-effort.
            }
          }
        }
        done();
      });

      // Capture the response body BEFORE serialization in `preSerialization`
      // (so we get the object form, not the JSON string). Fastify's
      // serialization can produce a string, buffer, stream, or null;
      // we capture the raw value and let the dashboard render it.
      instance.addHook('preSerialization', (request, _reply, payload, done) => {
        (
          request as FastifyRequest & {
            [RESPONSE_BODY_FLAG]?: { body: unknown; headers?: Record<string, string> };
          }
        )[RESPONSE_BODY_FLAG] = { body: payload };
        done();
      });

      // Capture response headers in `onSend` (post-serialization, when
      // the status code and headers are set). We also re-read the body
      // from preSerialization to handle the case where preSerialization
      // did not fire (some edge cases) — `onSend` payload is the
      // serialized string/buffer.
      instance.addHook('onSend', (request, reply, payload, done) => {
        const responseHeaders = redactHeaders(
          reply.getHeaders() as Record<string, string | string[] | undefined>,
          core.options.redactHeaders,
        );
        const record = (
          request as FastifyRequest & {
            [RECORD_ON_REQ]?: ReturnType<Core['internals']['startRequest']>;
          }
        )[RECORD_ON_REQ];
        if (!record) {
          done();
          return;
        }
        // Prefer the preSerialization body (object form), fall back to
        // the onSend payload (serialized string/buffer).
        const stored = (
          request as FastifyRequest & {
            [RESPONSE_BODY_FLAG]?: { body: unknown; headers?: Record<string, string> };
          }
        )[RESPONSE_BODY_FLAG] as { body?: unknown; headers?: Record<string, string> } | undefined;
        const body = stored?.body !== undefined ? stored.body : payload;
        (
          request as FastifyRequest & {
            [RESPONSE_BODY_FLAG]?: { body: unknown; headers: Record<string, string> };
          }
        )[RESPONSE_BODY_FLAG] = {
          body,
          headers: responseHeaders,
        };
        done();
      });

      // Capture errors. Fastify v5+ has the `onError` hook. v4 only has
      // `setErrorHandler`, which we use as a fallback. We do NOT replace
      // the default error handler: we just capture the error and return,
      // letting Fastify use its default response.
      const captureError = (request: FastifyRequest, error: unknown): void => {
        if (!(error instanceof Error)) return;
        const record = (
          request as FastifyRequest & {
            [RECORD_ON_REQ]?: ReturnType<Core['internals']['startRequest']>;
          }
        )[RECORD_ON_REQ];
        if (record) {
          (record as RequestRecordWithError).__xrayError = error;
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyInstance = instance as any;
      if (typeof anyInstance.addHook === 'function') {
        try {
          anyInstance.addHook(
            'onError',
            async (request: FastifyRequest, _reply: FastifyReply, error: unknown) => {
              captureError(request, error);
            },
          );
        } catch {
          // Fastify v4: no `onError` hook. Fall back to a manual error
          // handler that sends a default error response.
          anyInstance.setErrorHandler(
            (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
              captureError(request, error);
              if (!(error instanceof Error)) {
                void reply.code(500).send({ error: 'Internal Server Error' });
                return;
              }
              const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 500;
              void reply.code(statusCode).send({
                error: error.name,
                message: error.message,
              });
              return;
            },
          );
        }
      }

      // Finalize the record on response.
      instance.addHook('onResponse', (request, reply, done) => {
        const record = (
          request as FastifyRequest & {
            [RECORD_ON_REQ]?: ReturnType<Core['internals']['startRequest']>;
          }
        )[RECORD_ON_REQ];
        if (!record) {
          done();
          return;
        }

        const stored = (
          request as FastifyRequest & {
            [RESPONSE_BODY_FLAG]?: { body: unknown; headers: Record<string, string> };
          }
        )[RESPONSE_BODY_FLAG];

        const response: SnapshotSide = {
          headers:
            stored?.headers ??
            redactHeaders(
              reply.getHeaders() as Record<string, string | string[] | undefined>,
              core.options.redactHeaders,
            ),
        };
        if (core.options.captureResponseBody && stored?.body !== undefined) {
          response.body = stored.body;
        }

        const stashed = (record as RequestRecordWithError).__xrayError;
        const error: SerializedError | undefined = stashed ? serializeError(stashed) : undefined;

        const finalizeArg: Parameters<Core['internals']['finishRequest']>[0] = {
          record,
          status: reply.statusCode,
          response,
          durationMs: reply.elapsedTime,
        };
        if (error) finalizeArg.error = error;
        try {
          core.internals.finishRequest(finalizeArg);
        } catch (err) {
          core.options.onError(err instanceof Error ? err : new Error(String(err)), record);
        }
        done();
      });

      // Expose the core as a decorator. Useful for tests and custom sinks.
      instance.decorate('xray', core);
    },
    { name: '@node-xray/fastify' },
  );

  return Object.assign(pluginFn, {
    core,
    options: core.options,
  }) as unknown as XRayFastifyPlugin;
}

// --- internals --------------------------------------------------------------

let requestCounter = 0;
function generateRequestId(): string {
  const time = Date.now().toString(36);
  const counter = (requestCounter++).toString(36).padStart(4, '0');
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, '0');
  return `req_${time}${counter}${rand}`;
}

function splitPath(url: string): string {
  // Fastify's request.url includes the query string; strip it.
  const i = url.indexOf('?');
  return i >= 0 ? url.slice(0, i) : url;
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

interface RequestRecordWithError {
  __xrayError?: unknown;
}

interface RequestRecordMutable {
  request: { headers: Record<string, string>; body?: unknown };
}

// --- public type re-exports -----------------------------------------------

export type { XRayOptions } from '@node-xray/types';
export type { XRayContext } from '@node-xray/types';
export type { RequestRecord } from '@node-xray/types';
