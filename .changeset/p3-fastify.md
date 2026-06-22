---
'@node-xray/fastify': minor
---

Add the full P3 implementation of `@node-xray/fastify`.

`@node-xray/fastify` ships a Fastify plugin that drops into any
Fastify 4 or 5 app with one line:

```ts
import Fastify from 'fastify';
import { xrayPlugin } from '@node-xray/fastify';

const app = Fastify();
await app.register(xrayPlugin());

app.get('/api/users', async () => ({ ok: true }));

await app.listen({ port: 3000 });
// Dashboard: http://localhost:3000/node-xray
// WebSocket: ws://localhost:3000/node-xray/ws
```

The plugin uses `fastify-plugin` to disable encapsulation, so the
hooks apply to the whole app. It registers four Fastify hooks plus
an optional error handler:

- `onRequest` — creates the record and stores it on the request.
- `preHandler` — captures the parsed request body after Fastify's
  body parser has populated `request.body`, with full redaction
  applied.
- `preSerialization` — captures the response body in object form
  before Fastify serializes it (so the dashboard can render it
  without parsing JSON).
- `onSend` — captures the response headers.
- `onError` (Fastify v5+) or `setErrorHandler` (Fastify v4) —
  captures the error and attaches it to the in-flight record.
- `onResponse` — finalizes the record with the captured body,
  headers, status, and duration.

The plugin also:

- Exposes the `Core` as a decorator (`app.xray`) for tests and
  custom sinks.
- Honors the `ignore` predicate, the `enabled: false` no-op mode,
  and the production `auth` guard from P1.
- Mounts the dashboard and the WebSocket hub on the captured
  `http.Server` from `request.raw.socket.server`.

Tests: 17 fastify.inject integration tests cover GET/POST, body
capture (object + string + redacted + truncated), route pattern
capture, error propagation (500 + captured error), 404, the
ignore predicate, the dashboard route, concurrency (20 parallel
requests), and the no-op mode. Coverage: 82.57% lines, 77.08%
branches.
