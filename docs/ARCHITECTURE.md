# Architecture

> **Audience:** contributors and anyone who needs to understand the internals. If you only want to use `node-xray`, start with [`QUICKSTART.md`](./QUICKSTART.md).

This document describes the v1 design of `node-xray`. It is the result of the technical review captured in [`plan.md`](./plan.md) and the production-grade plan that was signed off before any code was written.

## 1. Goals and non-goals

### Goals

- A single-line integration for Express, Fastify, and NestJS.
- Per-request visibility: call stack, event-loop phase, async operations, request/response body.
- A live dashboard served from the same process, in development.
- Async context that survives `await`, `setTimeout`, microtasks, and `worker_threads` calls.
- Zero runtime dependencies in `@node-xray/core`.
- Bounded memory and predictable overhead.

### Non-goals (v1)

- Distributed tracing across services.
- Kafka / RabbitMQ / NATS / BullMQ / SQS instrumentation.
- A production-safe mode (the package is dev-only by default).
- Recording and replay of sessions.
- An APM product, a SaaS, a paid tier.

These are tracked in [`ROADMAP.md`](./ROADMAP.md) and will only be considered after v1 has been adopted.

## 2. Package layout

```
@node-xray/types       — Public type contracts (zero deps)
@node-xray/core        — Async context, event store, loop monitor, WS hub, redactor
@node-xray/express     — Express middleware
@node-xray/fastify     — Fastify plugin (encapsulated)
@node-xray/nestjs      — NestJS dynamic module + interceptor + decorator
@node-xray/dashboard   — UI assets + WebSocket server (mounted by the adapters)
```

The adapters depend on `@node-xray/core`. The dashboard package is a leaf and only re-exports assets and a server factory. There is no circular dependency.

## 3. The request lifecycle

The most important diagram in the whole codebase:

```
   HTTP request
        │
        ▼
┌──────────────────┐
│  Framework        │   Express: middleware
│  adapter          │   Fastify: onRequest hook
│  (xray / plugin)  │   NestJS: global HttpInterceptor
└────────┬─────────┘
         │  1. Generate requestId
         │  2. Start Record
         │  3. Capture request snapshot
         │  4. als.run(ctx, next)    ◀── context is now propagated
         ▼
┌──────────────────┐
│  User code        │   controller / service / repository
│  (your app)       │   every await, timer, DB call inherits ctx
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Framework        │   Express: res.on('finish')
│  adapter          │   Fastify: onResponse
│  (finish)         │   NestJS: HttpInterceptor afterHandle
└────────┬─────────┘
         │  5. Capture response body (if enabled)
         │  6. Capture status code, duration
         │  7. Emit 'request:done' to the store
         │  8. Broadcast to WS clients
         ▼
       Done
```

The single most important step is **4**. Every other piece of telemetry is meaningless without a correct async context.

## 4. Async context propagation

### Why `AsyncLocalStorage`

Node.js provides two primitives for tracking async context:

- `async_hooks` — low level, expensive, and dangerous when misused. Leaks and crashes are common.
- `AsyncLocalStorage` (ALS) — built on top of `async_hooks`, with a saner API, optimized for the common case, and what the Node core team recommends for this exact use case.

We use ALS exclusively. The footprint of `async_hooks` is still there, but it is amortized and tuned by Node, and the surface we expose is narrow enough that the foot-guns are avoided.

### What is in the context

```ts
interface XRayContext {
  requestId: string; // ULID, monotonic
  traceId: string; // shared across a logical user action
  spanId: string; // unique per logical operation
  parentSpanId?: string;
  framework: 'express' | 'fastify' | 'nestjs';
  route?: string; // matched route, not the raw URL
  method: string;
  startedAt: bigint; // process.hrtime.bigint()
  tags: Record<string, string | number | boolean>;
  refs: Map<string, unknown>; // escape hatch for adapters
}
```

### How it is set

Each adapter wraps the framework's "request started" hook with `als.run(ctx, next)`. The only writer to the store is the adapter; downstream code reads via `getContext()`.

### How it is read

- `getContext()` — returns the current `XRayContext` or `undefined`.
- `withTags(partial)` — returns a new context with merged tags. Use this for ad-hoc annotations from your code:

  ```ts
  import { withTags } from '@node-xray/core';
  await withTags({ userId: 42 }, async () => {
    // db.query() will be associated with userId: 42
  });
  ```

- `getContextOrThrow()` — same as `getContext()` but throws if no context is active. Useful in libraries that must run inside a request.

## 5. The event store

The store is an in-memory ring buffer of `RequestRecord` objects.

```ts
interface RequestRecord {
  id: string; // requestId
  method: string;
  path: string;
  route?: string;
  status: number; // 0 until done
  startedAt: number; // ms epoch
  durationMs: number | null; // null until done
  error?: SerializedError;
  timeline: TimelineEntry[]; // ordered, capped
  asyncOps: AsyncOp[]; // ordered, capped
  stack?: string[]; // sanitized, capped
  request: { headers: Record<string, string>; body?: unknown };
  response: { headers: Record<string, string>; body?: unknown };
  thread?: { busy: number; size: number };
  loop?: { lagMs: number; phase: EventLoopPhase };
}
```

Eviction is FIFO by `startedAt` once the buffer reaches `maxRequests` (default 200). The store is single-writer (the request-finish path) and multi-reader (the WS hub).

### Memory bound

The store has hard caps, not soft caps:

| Field                       | Cap (default) |
| --------------------------- | ------------- |
| Timeline entries per record | 500           |
| Async ops per record        | 200           |
| Stringified body            | 100 KB        |
| Stack frames per record     | 20            |
| Records in memory           | 200           |

When a cap is reached, the field is truncated and a `__truncated: true` marker is attached. The cap is enforced at write time, not at read time, so the cost is amortized.

## 6. Event loop and thread pool

### Event loop

`@node-xray/core` starts a `perf_hooks.monitorEventLoopDelay({ resolution: 20 })` instance on first use. It exposes a rolling 1-second window of `min/p50/p99/max` lag in milliseconds. We sample this every 500 ms and broadcast a `loop` frame to the dashboard.

`performance.eventLoopUtilization()` is also sampled. It is the percentage of time the loop was not idle. The dashboard uses it to drive the "Event Loop" ring.

### Thread pool

`UV_THREADPOOL_SIZE` is read at startup. The number of "busy" threads is reported as the count of in-flight async operations that the adapter knows about. The core package is intentionally conservative here: it does not monkey-patch `fs`, `dns`, or `crypto`. Adapters that observe a long-running async (e.g. a `pg.query` that is awaiting I/O) increment a counter; on completion they decrement it.

This is a best-effort signal, not a precise measurement. The dashboard labels it "advisory".

## 7. The WebSocket hub

A single `ws.WebSocketServer` is bound to `<path>/ws`. It speaks a versioned JSON protocol (see [`EVENTS.md`](./EVENTS.md)).

```ts
type WireFrame =
  | { v: 1; t: 'hello'; payload: HelloPayload }
  | { v: 1; t: 'snapshot'; payload: RequestRecord[] }
  | { v: 1; t: 'request:new'; payload: RequestRecord }
  | { v: 1; t: 'request:update'; payload: { id: string; patch: Partial<RequestRecord> } }
  | { v: 1; t: 'request:done'; payload: { id: string; record: RequestRecord } }
  | { v: 1; t: 'stats'; payload: StatsPayload }
  | { v: 1; t: 'loop'; payload: { lagMs: number; utilization: number; phase: EventLoopPhase } };
```

Backpressure: before each `send`, we check `socket.readyState === OPEN` and `socket.bufferedAmount < 1_048_576` (1 MB). If either fails, the frame is dropped and a `backpressure:dropped` counter is incremented. The dashboard shows it.

Reconnect: the client uses exponential backoff (1s, 2s, 4s, …, capped at 30s) and replays `snapshot` on reconnect so a freshly opened tab shows the last 200 requests.

## 8. Redaction

Redaction is a first-class concern, not an afterthought.

### Headers

A default-deny list is applied to both request and response headers:

- `authorization`
- `cookie`
- `set-cookie`
- `x-api-key`
- `proxy-authorization`

User-supplied names (case-insensitive) are merged. Redacted values are replaced with `'[REDACTED]'`.

### Body paths

A JSON-pointer-style path list is applied to parsed JSON bodies:

- `'password'` — top-level
- `'*.token'` — every nested `token`
- `'cards[*].cvv'` — every `cvv` inside any `cards` array
- `'a.b.c'` — deep path

The walker is depth-limited (default 16) to avoid pathological input.

### Truncation

Bodies larger than `maxBodySize` (default 100 KB) are replaced with:

```json
{ "__truncated": true, "originalSize": 248213 }
```

The original is dropped before it ever reaches the store.

## 9. Failure model

`node-xray` is a debug tool, not a control plane. It must never take down the host app.

- Every callback in the public API is wrapped in a try/catch.
- The `onError` option receives every internal error. The default is `console.error` with a `[node-xray]` prefix.
- Errors in body parsing are recorded as `{ parseError: 'message' }` and never thrown.
- Errors in the WS hub kill only the WS server. The HTTP server is unaffected.
- The store is bounded. There is no path that can grow it unboundedly.
- The dashboard mount path is registered with a guard that throws at startup if it collides with an existing route.

## 10. Build, test, and release

- TypeScript 5.4, strict mode, ESM-first, dual CJS+ESM via `tsup`.
- `vitest` for unit and integration tests.
- `eslint` flat config + `prettier` for style.
- `husky` + `lint-staged` + `commitlint` for hygiene.
- `@changesets/cli` for versioning.
- `pnpm` workspaces, CI on Node 20.18, 22.11, 24.x (Ubuntu + Windows).
- Release: a `Version Packages` PR is opened by changesets; on merge, a workflow publishes every changed package to npm with `--provenance`.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full developer guide.

## 11. Design decisions log

| Decision                                                    | Rationale                                 | Alternative considered   |
| ----------------------------------------------------------- | ----------------------------------------- | ------------------------ |
| `AsyncLocalStorage` over raw `async_hooks`                  | Safer, faster, recommended by Node core   | raw `async_hooks`        |
| Ring buffer over unbounded log                              | Bounded memory, predictable overhead      | append-only file, SQLite |
| Versioned wire protocol (`v: 1`)                            | Allows evolution without breaking clients | unversioned JSON         |
| Default-deny header redaction                               | Safer default; users opt out, not in      | default-allow            |
| Refuse to mount in prod without `auth`                      | The package is dev-only by intent         | warning + log            |
| No React, no build step in the dashboard (Vite output only) | Smaller surface, faster cold start        | full SPA framework       |
| Single per-process WS server                                | Simplest correct thing                    | socket.io, SSE           |
| `tsup` for builds                                           | Best ESM/CJS dual output for libraries    | rollup, unbuild          |
| `vitest` over `jest`                                        | Native ESM, faster, simpler config        | jest + ts-jest           |
| `pnpm` workspaces                                           | Strict, fast, great for monorepos         | npm workspaces, yarn 4   |
