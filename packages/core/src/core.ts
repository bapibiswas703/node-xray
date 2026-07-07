import type { Server as HttpServer } from 'node:http';
import type {
  XRayOptions,
  RequestRecord,
  TimelineEntry,
  AsyncOp,
  SerializedError,
  SnapshotSide,
  LoopStats,
  StatsPayload,
} from '@node-xray/types';
import { XRayConfigError } from './errors.js';
import { resolveOptions, type ResolvedOptions } from './config.js';
import { startLoopMonitor, eventLoopUtilization, currentEventLoopPhase } from './loop.js';
import { captureStack } from './stack.js';
import { redactHeaders, redactSnapshot } from './redact.js';
import { RequestStore, createPartialRecord, appendTimeline, appendAsyncOp } from './store.js';
import { createHub } from './ws.js';
import { mountDashboard } from './dashboard.js';
import { createStatsEmitter } from './stats.js';
import { emit } from './events.js';

export interface Core {
  /** The resolved options (read-only snapshot). */
  readonly options: ResolvedOptions;
  /** The in-memory store. */
  readonly store: RequestStore;
  /**
   * Start the WebSocket hub and (optionally) the dashboard UI on a
   * Node `http.Server`. Pass `assetsDir` to enable the dashboard
   * route; without it the route returns a 503 placeholder. Pass
   * `serveHttp: false` when the adapter serves the dashboard HTML and
   * assets itself and only the WebSocket side is wanted here.
   */
  mount(server: HttpServer, options?: { assetsDir?: string; serveHttp?: boolean }): void;
  /** Stop everything (loop monitor, hub, store). */
  close(): Promise<void>;
  /** Internal helpers used by adapters. */
  readonly internals: CoreInternals;
}

export interface CoreInternals {
  /** Start a new request record and return the partial record. */
  startRequest(input: StartRequestInput): RequestRecord;
  /** Append a timeline entry to a record. */
  addTimeline(record: RequestRecord, entry: TimelineEntry): RequestRecord;
  /** Append an async op to a record. */
  addAsyncOp(record: RequestRecord, op: AsyncOp): RequestRecord;
  /** Mark a request as done and broadcast the final record. */
  finishRequest(input: FinishRequestInput): RequestRecord;
  /** Read the latest loop stats. */
  loopStats(): LoopStats;
  /** Read the current event-loop utilization. */
  loopUtilization(): number;
  /** Read the current best-effort phase. */
  loopPhase(): LoopStats['phase'];
  /** Increment / decrement the in-flight thread-pool counter (advisory). */
  threadMark(busy: boolean): void;
  /** Read a fresh aggregate snapshot. Used by the stats emitter and tests. */
  snapshotStats(): StatsPayload;
}

export interface StartRequestInput {
  id: string;
  method: string;
  path: string;
  route?: string;
  framework: 'express' | 'fastify' | 'nestjs' | 'custom';
  request: SnapshotSide;
  tags?: Record<string, string | number | boolean>;
}

export interface FinishRequestInput {
  record: RequestRecord;
  status: number;
  response: SnapshotSide;
  durationMs: number;
  error?: SerializedError;
  stack?: string[];
}

/**
 * Create a `Core` instance. Adapters consume this; user code should not.
 *
 * The returned object is process-singleton friendly: every adapter
 * should share one `Core` per process. If `options.enabled` is `false`,
 * the core is created in a "muted" mode where every method is a no-op
 * and `mount()` does nothing.
 */
export function createCore(options: XRayOptions = {}): Core {
  const resolved = resolveOptions(options);
  if (!resolved.enabled) return mutedCore(resolved);

  const store = new RequestStore({ maxRequests: resolved.maxRequests });
  const monitor = startLoopMonitor();
  let threadBusy = 0;
  const hub = createHub({
    path: resolved.path,
    maxClients: resolved.websocket.maxClients,
    store,
    getHelloConfig: () => ({
      path: resolved.path,
      maxRequests: resolved.maxRequests,
      captureRequestBody: resolved.captureRequestBody,
      captureResponseBody: resolved.captureResponseBody,
    }),
    getServerInfo: () => ({
      node: process.version,
      pid: process.pid,
      uptime: process.uptime(),
      framework: 'node-xray',
      version: '0.2.0',
    }),
    onClear: () => {
      stats.reset();
    },
  });
  const stats = createStatsEmitter({
    monitor,
    getThreadBusy: () => threadBusy,
    getDropped: () => hub.droppedCount(),
    onStats: (payload) => {
      emit('stats', payload);
    },
  });

  const internals: CoreInternals = {
    startRequest(input) {
      if (resolved.ignore({ path: input.path, method: input.method })) {
        throw new XRayConfigError(
          'startRequest called for an ignored path. Adapters must check `ignore` before calling.',
        );
      }
      const record = createPartialRecord(input);
      if (input.tags) record.tags = { ...input.tags };
      if (resolved.stack.enabled) {
        const stack = captureStack(resolved.stack);
        if (stack) record.stack = stack;
      }
      record.request = {
        headers: redactHeaders(input.request.headers, resolved.redactHeaders),
        ...(resolved.captureRequestBody
          ? {
              body: redactSnapshot(
                input.request.body,
                resolved.redactBodyPaths,
                resolved.maxBodySize,
              ),
            }
          : {}),
      };
      store.add(record);
      stats.noteStartRequest();
      return record;
    },
    addTimeline(record, entry) {
      const next = appendTimeline(record, entry);
      store.update(record.id, { timeline: next.timeline });
      return next;
    },
    addAsyncOp(record, op) {
      const next = appendAsyncOp(record, op);
      store.update(record.id, { asyncOps: next.asyncOps });
      return next;
    },
    finishRequest(input) {
      const final: RequestRecord = {
        ...input.record,
        status: input.status,
        durationMs: input.durationMs,
        response: {
          headers: redactHeaders(input.response.headers, resolved.redactHeaders),
          ...(resolved.captureResponseBody
            ? {
                body: redactSnapshot(
                  input.response.body,
                  resolved.redactBodyPaths,
                  resolved.maxBodySize,
                ),
              }
            : {}),
        },
        ...(input.error ? { error: input.error } : {}),
        ...(input.stack ? { stack: input.stack } : {}),
        loop: { lagMs: monitor.latest().lagMs, phase: currentEventLoopPhase() },
      };
      stats.noteFinishRequest({ status: input.status, durationMs: input.durationMs });
      store.finish(final);
      return final;
    },
    loopStats: () => monitor.latest(),
    loopUtilization: () => eventLoopUtilization(),
    loopPhase: () => currentEventLoopPhase(),
    threadMark(busy) {
      threadBusy = Math.max(0, threadBusy + (busy ? 1 : -1));
    },
    snapshotStats: () => stats.latest(),
  };

  let mounted = false;
  return {
    options: resolved,
    store,
    mount(server, opts) {
      if (mounted) {
        throw new XRayConfigError('core.mount() called twice on the same instance.');
      }
      mounted = true;
      mountDashboard(server, (s) => hub.attach(s), {
        path: resolved.path,
        ...(opts?.assetsDir ? { assetsDir: opts.assetsDir } : {}),
        ...(opts?.serveHttp === false ? { serveHttp: false } : {}),
        ...(resolved.auth ? { auth: resolved.auth } : {}),
        onError: resolved.onError,
      });
    },
    async close() {
      stats.stop();
      monitor.stop();
      await hub.close();
    },
    internals,
  };
}

function mutedCore(options: ResolvedOptions): Core {
  const noopStats: LoopStats = {
    lagMs: 0,
    p50: 0,
    p99: 0,
    max: 0,
    utilization: 0,
    phase: 'unknown',
    sampledAt: 0,
  };
  return {
    options,
    store: new RequestStore({ maxRequests: 1 }),
    mount: () => {
      /* no-op when disabled */
    },
    async close() {
      /* no-op */
    },
    internals: {
      startRequest: ((_input: StartRequestInput): RequestRecord => {
        throw new XRayConfigError('startRequest called on a muted core.');
      }) as CoreInternals['startRequest'],
      addTimeline: ((r: RequestRecord, e: TimelineEntry): RequestRecord =>
        appendTimeline(r, e)) as CoreInternals['addTimeline'],
      addAsyncOp: ((r: RequestRecord, o: AsyncOp): RequestRecord =>
        appendAsyncOp(r, o)) as CoreInternals['addAsyncOp'],
      finishRequest: ((_input: FinishRequestInput): RequestRecord => {
        throw new XRayConfigError('finishRequest called on a muted core.');
      }) as CoreInternals['finishRequest'],
      loopStats: () => noopStats,
      loopUtilization: () => 0,
      loopPhase: () => 'unknown',
      threadMark: () => {
        /* no-op */
      },
      snapshotStats: () => ({
        reqCount: 0,
        errors: 0,
        avgMs: 0,
        loopLagP99: 0,
        poolBusy: 0,
        poolSize: 0,
        backpressureDropped: 0,
      }),
    },
  };
}
