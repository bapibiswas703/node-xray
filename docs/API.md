# API reference

> Public API of `@node-xray/core`. Adapters expose the same options (see [`CONFIGURATION.md`](./CONFIGURATION.md)) and may add a few framework-specific knobs.

## Module entry

```ts
import {
  // context
  getContext,
  getContextOrThrow,
  withTags,
  withContext,

  // events
  on,
  off,
  emit,

  // store
  getStore,
  getRequest,
  listRequests,
  clearStore,

  // loop
  getLoopStats,

  // dashboard
  mountDashboard,

  // types
  type XRayOptions,
  type XRayContext,
  type RequestRecord,
  type TimelineEntry,
  type AsyncOp,
  type EventLoopPhase,
  type XRayEventName,
  type XRayEventPayload,
} from '@node-xray/core';
```

## Context

### `getContext(): XRayContext | undefined`

Returns the current async-local context, or `undefined` if called outside a tracked request.

```ts
import { getContext } from '@node-xray/core';

app.get('/who', (req, res) => {
  const ctx = getContext();
  res.json({ requestId: ctx?.requestId });
});
```

### `getContextOrThrow(): XRayContext`

Same as `getContext`, but throws `XRayNoContextError` if there is no context. Use in libraries that must run inside a request:

```ts
import { getContextOrThrow } from '@node-xray/core';

export async function dbQuery(q: string) {
  const ctx = getContextOrThrow();
  ctx.tags['db.query'] = q;
  return pool.query(q);
}
```

### `withTags(tags, fn)`

Runs `fn` inside a new context where the tags are merged in. The original context is restored when `fn` returns or throws.

```ts
import { withTags } from '@node-xray/core';

await withTags({ userId: 42, plan: 'pro' }, async () => {
  // every async op below inherits userId: 42 and plan: 'pro'
  return db.query('SELECT * FROM users WHERE id = $1', [42]);
});
```

### `withContext(ctx, fn)`

Runs `fn` inside a copy of `ctx`. Use this when you want to start a child span from an existing one:

```ts
import { withContext, getContextOrThrow } from '@node-xray/core';

const parent = getContextOrThrow();
await withContext({ ...parent, parentSpanId: parent.spanId, spanId: ulid() }, async () => {
  // child span
});
```

## Events

A tiny event emitter on top of the internal bus. Used for both the WS hub and for third-party sinks.

### `on(name, listener): unsubscribe`

```ts
import { on } from '@node-xray/core';

const off = on('request:done', (record) => {
  console.log(record.method, record.path, record.status, record.durationMs);
});

process.on('SIGTERM', off);
```

Event names:

- `'request:new'` — payload: `RequestRecord` (status 0, partial).
- `'request:update'` — payload: `{ id, patch }` where `patch` is a partial record.
- `'request:done'` — payload: `RequestRecord` (final).
- `'loop'` — payload: `{ lagMs, utilization, phase }` (every 500 ms).
- `'error'` — payload: `Error` plus the context that was active.

### `off(name, listener)`

Removes a listener. Pair it with `on`:

```ts
const listener = (r) => doStuff(r);
on('request:done', listener);
// later
off('request:done', listener);
```

### `emit(name, payload)`

Synchronously dispatches an event. Use this from custom adapters to publish domain events. Listeners run in registration order.

## Store

The store is the in-memory ring buffer. The public functions are read-only views; writes are funneled through the adapter.

### `getStore(): RequestStore`

Returns the singleton store. The shape is:

```ts
interface RequestStore {
  readonly size: number;
  list(): readonly RequestRecord[];
  get(id: string): RequestRecord | undefined;
  clear(): void;
  subscribe(fn: (records: readonly RequestRecord[]) => void): () => void;
}
```

### `getRequest(id)`

Convenience wrapper over `getStore().get(id)`.

### `listRequests()`

Convenience wrapper over `getStore().list()`. Returns a readonly array, snapshot — safe to iterate without locking.

### `clearStore()`

Empties the buffer. Used by the "clear" button in the dashboard.

## Loop

### `getLoopStats()`

Returns the latest sampled event-loop statistics:

```ts
interface LoopStats {
  lagMs: number; // current lag
  p50: number; // 1-second rolling p50
  p99: number; // 1-second rolling p99
  max: number; // 1-second rolling max
  utilization: number; // 0..1
  phase: EventLoopPhase;
  sampledAt: number; // ms epoch
}

type EventLoopPhase = 'timers' | 'pending' | 'idle' | 'poll' | 'check' | 'close' | 'unknown';
```

The phase is best-effort; it is read from `performance` internals where available and falls back to `'unknown'`. The dashboard uses it only as a label.

## Dashboard

### `mountDashboard(app, opts)`

Mounts the dashboard route and the WebSocket on a given framework "app" object. The adapters call this for you. If you write a custom adapter, call it directly:

```ts
import { mountDashboard } from '@node-xray/core';

mountDashboard(httpServer, {
  path: '/node-xray',
  auth: { type: 'bearer', token: process.env.XRAY_TOKEN! },
});
```

The first argument must be a Node `http.Server` (or an object with a `server` property — Fastify's app, for example). The second is a partial `XRayOptions`; anything you omit falls back to the global options.

## Types

### `XRayContext`

```ts
interface XRayContext {
  requestId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  framework: 'express' | 'fastify' | 'nestjs' | 'custom';
  route?: string;
  method: string;
  path: string;
  startedAt: bigint; // process.hrtime.bigint()
  tags: Record<string, string | number | boolean>;
  refs: Map<string, unknown>;
}
```

### `RequestRecord`

See [`ARCHITECTURE.md`](./ARCHITECTURE.md#the-event-store).

### `TimelineEntry`

```ts
interface TimelineEntry {
  at: number; // ms since request start
  kind: 'sync' | 'await' | 'timer' | 'io' | 'db' | 'http' | 'render' | 'send';
  name: string;
  detail?: string;
  durationMs?: number;
}
```

### `AsyncOp`

```ts
interface AsyncOp {
  id: string;
  kind: 'db' | 'http' | 'fs' | 'crypto' | 'dns' | 'other';
  label: string; // 'pg.query', 'http.request', ...
  startedAt: number;
  durationMs: number | null;
  detail?: string; // SQL, URL, etc. (redacted)
  status: 'pending' | 'done' | 'error';
  error?: string;
}
```

### `XRayOptions`

See [`CONFIGURATION.md`](./CONFIGURATION.md).

## Errors

The package exports a small hierarchy:

```ts
class XRayError extends Error {}
class XRayNoContextError extends XRayError {}
class XRayConfigError extends XRayError {} // thrown at registration
class XRayStoreFullError extends XRayError {} // never thrown; reserved
class XRayWireError extends XRayError {} // WS protocol errors
```

All errors are safe to `instanceof` and have a stable `code` string:

```ts
err.code === 'XRAY_NO_CONTEXT';
err.code === 'XRAY_CONFIG';
err.code === 'XRAY_WIRE';
```

## Stability

The public surface is what is exported from `@node-xray/core`. Anything not exported is internal and may change without notice. Adapters and the dashboard are versioned together with the core package — a single `node-xray@1.x.y` release covers all of them.
