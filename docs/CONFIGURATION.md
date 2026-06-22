# Configuration

Every public option in `node-xray`, with its default, its type, and the security and performance implications of changing it.

The option object is the same shape across all three adapters. `@node-xray/core` exports the `XRayOptions` type so adapters can extend it if they need to.

```ts
import type { XRayOptions } from '@node-xray/core';
```

## The option matrix

| Option                | Type                           | Default                                                                                          | Section                 |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------- |
| `enabled`             | `boolean`                      | `process.env.NODE_ENV !== 'production'`                                                          | [Lifecycle](#lifecycle) |
| `path`                | `string`                       | `'/node-xray'`                                                                                   | [Mounting](#mounting)   |
| `captureRequestBody`  | `boolean`                      | `true` in dev, `false` in prod                                                                   | [Bodies](#bodies)       |
| `captureResponseBody` | `boolean`                      | `true` in dev, `false` in prod                                                                   | [Bodies](#bodies)       |
| `maxBodySize`         | `number`                       | `102_400` (100 KB)                                                                               | [Bodies](#bodies)       |
| `maxRequests`         | `number`                       | `200`                                                                                            | [Store](#store)         |
| `ignore`              | `(ctx) => boolean`             | `[/favicon.ico, /node-xray/*]`                                                                   | [Filtering](#filtering) |
| `redactHeaders`       | `string[]`                     | `['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization']`                  | [Redaction](#redaction) |
| `redactBodyPaths`     | `string[]`                     | `['password', 'token', 'secret', 'apiKey', '*.password', '*.token', '*.secret', 'cards[*].cvv']` | [Redaction](#redaction) |
| `sampleRate`          | `number`                       | `1`                                                                                              | [Sampling](#sampling)   |
| `stack`               | `{ enabled, rate, maxFrames }` | `{ enabled: true, rate: 0.1, maxFrames: 20 }`                                                    | [Stack](#stack)         |
| `websocket`           | `{ enabled, maxClients }`      | `{ enabled: true, maxClients: 4 }`                                                               | [WebSocket](#websocket) |
| `auth`                | `{ type, ... }`                | `undefined` (required in non-dev)                                                                | [Auth](#auth)           |
| `onError`             | `(err, ctx) => void`           | `console.error` with `[node-xray]` prefix                                                        | [Errors](#errors)       |

## Lifecycle

### `enabled`

```ts
xray({ enabled: process.env.NODE_ENV !== 'production' });
```

When `false`, the adapter is a no-op: no context is created, no events are recorded, no dashboard is mounted. The option is checked at every entry point so a runtime toggle works:

```ts
process.env.NODE_ENV = 'production';
// xray() returns a middleware that calls next() and does nothing
```

In dev, the default is `true`. In production, the default is `false`. The dashboard refuses to mount in production unless `auth` is also set.

## Mounting

### `path`

```ts
xray({ path: '/__debug/xray' });
```

The dashboard is served at `${path}` and the WebSocket at `${path}/ws`. The path must:

- Start with `/`.
- Not contain `..` segments.
- Not collide with an existing route on the same app. The adapter throws at registration time if it does.

If the path contains a wildcard (e.g. `/debug/*`), only the exact path and the `ws` sub-path are mounted.

## Bodies

### `captureRequestBody`

When `true`, the adapter snapshots `req.body` (for Express, after `express.json()` / `express.urlencoded()`) or the raw stream (otherwise). The snapshot is deep-cloned and redacted before storage.

In dev, default `true`. In prod, default `false`. Enable explicitly if you know what you are doing.

### `captureResponseBody`

When `true`, the adapter captures the response payload. The mechanism differs per framework — see [`FRAMEWORKS.md`](./FRAMEWORKS.md). The payload is deep-cloned and redacted.

### `maxBodySize`

The hard cap, in bytes, on a single body. Bodies larger than this are replaced with `{ __truncated: true, originalSize }`. The default is 100 KB. The cap is enforced before redaction so a 10 MB body with one small redacted field still costs only 100 KB.

Memory cost: `maxBodySize` × `maxRequests` (worst case, when every body hits the cap). With defaults, that is ~20 MB. Tighten if you are memory-constrained.

## Store

### `maxRequests`

The size of the in-memory ring buffer. The default 200 is enough to cover a debugging session; raise it to 1000+ only if you need to scroll back further. Memory scales linearly.

When the buffer is full, the oldest record is evicted FIFO. There is no LRU, no "favorites", no "pinned" requests.

## Filtering

### `ignore`

A predicate that returns `true` for requests that should not be recorded. The default ignores:

- `GET /favicon.ico`
- Anything under `path` (the dashboard and its assets)

```ts
xray({
  ignore: (ctx) => ctx.path === '/health' || ctx.path.startsWith('/_next/'),
});
```

The predicate runs before body capture, so ignored requests cost almost nothing.

## Redaction

### `redactHeaders`

A list of header names (case-insensitive) whose values are replaced with `'[REDACTED]'`. Merged with the default deny list. Set to `[]` to disable header redaction entirely — not recommended.

### `redactBodyPaths`

A list of paths, in a small subset of JSONPath / JSON-pointer syntax:

- `'password'` — top-level
- `'*.token'` — every nested `token`
- `'cards[*].cvv'` — every `cvv` inside `cards` array items
- `'a.b.c'` — deep path

The walker is depth-limited to 16. Cycles are detected and the cyclic subtree is replaced with `'[CYCLE]'`.

The default list covers the common cases. Extend it for your domain.

## Sampling

### `sampleRate`

A number in `[0, 1]`. Default `1` (record every request). Set to `0.1` to record 1 in 10 requests. Useful when you are in a hot loop and only need a statistical sample.

Sampling is per-request, decided at the start of the request, and not correlated with anything else.

## Stack

### `stack`

```ts
xray({
  stack: { enabled: true, rate: 0.1, maxFrames: 20 },
});
```

- `enabled` — capture a stack trace at request start. Default `true`.
- `rate` — fraction of requests that get a full stack. Default `0.1` (10%). The rest get a cheap shim stack. The dashboard labels sampled stacks with a `sampled` badge.
- `maxFrames` — frames kept after sanitization. Default `20`.

Stack capture uses `Error.captureStackTrace` and `Error.prepareStackTrace`. It strips `node_modules` frames and collapses anonymous frames. The cost is roughly 50–200 µs per request at `rate: 1`; lower it for hot paths.

## WebSocket

### `websocket`

```ts
xray({
  websocket: { enabled: true, maxClients: 4 },
});
```

- `enabled` — start the WS server. Default `true`.
- `maxClients` — hard cap on concurrent dashboard tabs. The 5th connection is rejected with code `1013` (try again later).

If you are running the dashboard over the public internet (do not, see [`SECURITY.md`](./SECURITY.md)), set `maxClients` to a small number to avoid amplification.

## Auth

### `auth`

```ts
// HTTP Basic
xray({
  auth: { type: 'basic', user: 'admin', pass: process.env.XRAY_PASS! },
});

// Bearer token
xray({
  auth: { type: 'bearer', token: process.env.XRAY_TOKEN! },
});

// Custom async check
xray({
  auth: {
    type: 'custom',
    verify: async (req) => req.headers['x-debug-token'] === process.env.XRAY_TOKEN,
  },
});
```

The auth gate protects the dashboard route **and** the WebSocket upgrade. If the gate fails, the WS upgrade is closed with code `1008` (policy violation).

In `NODE_ENV !== 'production'`, `auth` is optional. In production, the adapter throws at startup if `auth` is missing. This is intentional. See [`SECURITY.md`](./SECURITY.md).

## Errors

### `onError`

```ts
xray({
  onError: (err, ctx) => myLogger.warn({ err, ctx }, 'xray internal error'),
});
```

Every internal error is funnelled through this hook. The default is `console.error` with a `[node-xray]` prefix. The hook is invoked synchronously; do not throw from it.

## Merging with environment

A common pattern is to read a base config from the environment:

```ts
import { xray } from '@node-xray/express';

xray({
  enabled: process.env.XRAY_ENABLED !== 'false',
  maxRequests: Number(process.env.XRAY_MAX_REQUESTS) || 200,
  auth: process.env.XRAY_TOKEN ? { type: 'bearer', token: process.env.XRAY_TOKEN } : undefined,
});
```

The package never reads environment variables itself; this is a deliberate choice so behavior is fully explicit.
