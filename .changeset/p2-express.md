---
'@node-xray/express': minor
'@node-xray/core': patch
'@node-xray/types': patch
---

Add the full P2 implementation of `@node-xray/express`.

`@node-xray/express` ships an Express middleware that drops into any
Express 4 or Express 5 app:

```ts
import express from 'express';
import { xray } from '@node-xray/express';

const app = express();
app.use(express.json());   // body parsers FIRST
app.use(xray());          // xray AFTER body parsers
app.listen(3000);
```

The middleware:

- Lazily creates a `Core` on the first request.
- Auto-mounts the dashboard and the WebSocket hub on the captured
  `http.Server` (with CSP headers, `Origin` allowlist, basic/bearer/
  custom auth, and backpressure handling — all inherited from P1).
- Serves the dashboard redirect at `xray.options.path` *before*
  Express's 404 handler, via the same middleware, so there is no
  Express-vs-handler race.
- Snapshots the parsed request body after `express.json()` /
  `express.urlencoded()` runs upstream, applying the default-deny
  header redaction and the JSON-path body redaction.
- Intercepts `res.json()`, `res.send()`, `res.write()`, and
  `res.end()` to capture the response payload up to
  `maxBodySize`, honoring text-vs-binary detection, stream
  redaction, and response-body redaction.
- Resolves the matched route pattern (e.g. `/api/users/:id`) and
  includes it on the final record.
- Provides a separate `xray.errorHandler` middleware that captures
  `next(err)` errors and attaches them to the in-flight record
  before the response is sent.
- Honors the `ignore` predicate, the `enabled: false` no-op mode,
  and the production `auth` guard from P1.

`@node-xray/core` re-exports `_clearAllForTest` so adapters and
tests can clear the event bus between cases.

Tests: 19 supertest integration tests cover GET/POST, streaming
chunks, SSE-style `res.write`+`res.end`, error propagation, 404,
the ignore predicate, the dashboard route, the error middleware,
concurrency, and the no-op mode. Coverage: 88.96% lines,
72.36% branches.
