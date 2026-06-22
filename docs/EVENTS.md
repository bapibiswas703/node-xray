# Events

The `node-xray` wire protocol. Public, versioned, stable across the v1 line. This document is the source of truth for anyone building a custom sink or a custom dashboard.

## Versioning

Every frame carries a `v: 1` field. The protocol is versioned independently of the package version. A new `v: 2` is added before any breaking change; both are supported during the transition.

## Frames

### `hello`

Sent once, immediately after the WebSocket upgrade.

```ts
{
  v: 1,
  t: 'hello',
  payload: {
    config: {
      path: '/node-xray',
      maxRequests: 200,
      captureRequestBody: true,
      captureResponseBody: true,
      // ... subset of public options
    },
    server: {
      node: 'v20.11.0',
      pid: 12345,
      uptime: 123.4,
      framework: 'express',
      version: '1.0.0',
    }
  }
}
```

The `config` field is a _subset_ of the public options. Sensitive fields (`auth`, `redactHeaders`) are not included.

### `snapshot`

Sent once, immediately after `hello`. Replayed on reconnect.

```ts
{
  v: 1,
  t: 'snapshot',
  payload: RequestRecord[]   // length <= maxRequests, newest last
}
```

### `request:new`

Pushed when a request starts. The record is partial — `status` is `0`, `durationMs` is `null`, `response.body` is missing.

```ts
{
  v: 1,
  t: 'request:new',
  payload: RequestRecord
}
```

### `request:update`

Pushed on incremental updates to a request (a new timeline entry, a new async op, a stack change). The `patch` is a shallow merge into the existing record.

```ts
{
  v: 1,
  t: 'request:update',
  payload: { id: string, patch: Partial<RequestRecord> }
}
```

`request:update` is rate-limited. The server coalesces multiple updates within a 16 ms window into one frame. The dashboard always gets the final, authoritative `request:done` frame afterwards.

### `request:done`

Pushed exactly once per request, when the response is finished.

```ts
{
  v: 1,
  t: 'request:done',
  payload: { id: string, record: RequestRecord }
}
```

After this frame, the record will not be updated again.

### `stats`

Pushed every 500 ms, summarizing the buffer.

```ts
{
  v: 1,
  t: 'stats',
  payload: {
    reqCount: number,
    errors: number,
    avgMs: number,
    loopLagP99: number,
    poolBusy: number,
    poolSize: number,
    backpressureDropped: number
  }
}
```

### `loop`

Pushed every 500 ms.

```ts
{
  v: 1,
  t: 'loop',
  payload: {
    lagMs: number,
    utilization: number,   // 0..1
    phase: 'timers' | 'pending' | 'idle' | 'poll' | 'check' | 'close' | 'unknown',
    sampledAt: number       // ms epoch
  }
}
```

## Record schema

The `RequestRecord` schema is the same shape on the wire as in the public API:

```ts
interface RequestRecord {
  id: string;
  method: string;
  path: string;
  route?: string;
  status: number;
  startedAt: number;
  durationMs: number | null;
  error?: { name: string; message: string; stack?: string };
  timeline: TimelineEntry[];
  asyncOps: AsyncOp[];
  stack?: string[];
  request: {
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    headers: Record<string, string>;
    body?: unknown;
  };
  thread?: { busy: number; size: number };
  loop?: { lagMs: number; phase: EventLoopPhase };
  framework: 'express' | 'fastify' | 'nestjs' | 'custom';
  tags: Record<string, string | number | boolean>;
}
```

The dashboard is permissive: unknown fields are ignored, missing fields are filled with safe defaults. The server never assumes the client is up to date.

## Writing a custom sink

A "sink" is anything that subscribes to the event bus. The dashboard is a sink. You can write your own:

```ts
import { on } from '@node-xray/core';
import { writeFile } from 'node:fs/promises';

on('request:done', async (record) => {
  await writeFile(`./xray/${record.id}.json`, JSON.stringify(record, null, 2));
});
```

Sinks run in the same process. Be careful with the work they do — slow sinks slow down request completion because the bus is synchronous. If you need async work, buffer and flush on a timer.

## Writing a custom dashboard

The protocol is plain JSON over WebSocket. The reference dashboard is the `index.html` in `@node-xray/dashboard`. To write a different one, connect to the same `<path>/ws` and speak the protocol.

There is no auth on the protocol layer beyond the HTTP-level auth configured via `xray({ auth })`. If you do not configure auth, the WebSocket upgrade is open. See [`SECURITY.md`](./SECURITY.md).

## Limits and backpressure

The server caps concurrent clients via `websocket.maxClients` (default 4). Beyond that, the upgrade is closed with code `1013`.

Per-client backpressure: before each `send`, the server checks `socket.readyState === OPEN` and `socket.bufferedAmount < 1_048_576` (1 MB). If either fails, the frame is dropped and `backpressureDropped` is incremented in the next `stats` frame. The dashboard never blocks the server.
