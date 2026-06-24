# @node-xray/express

## 0.2.0

### Minor Changes

- 3a9b6fd: Add the full P2 implementation of `@node-xray/express`.

  `@node-xray/express` ships an Express middleware that drops into any
  Express 4 or Express 5 app:

  ```ts
  import express from 'express';
  import { xray } from '@node-xray/express';

  const app = express();
  app.use(express.json()); // body parsers FIRST
  app.use(xray()); // xray AFTER body parsers
  app.listen(3000);
  ```

  The middleware:

  - Lazily creates a `Core` on the first request.
  - Auto-mounts the dashboard and the WebSocket hub on the captured
    `http.Server` (with CSP headers, `Origin` allowlist, basic/bearer/
    custom auth, and backpressure handling — all inherited from P1).
  - Serves the dashboard redirect at `xray.options.path` _before_
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

- 2f7c27f: Replace the inline placeholder dashboard with the real `@node-xray/dashboard`
  package. The dashboard ships as three static assets (`index.html`,
  `app.js`, `styles.css`) that the adapters discover through the new
  `getAssetsDir()` helper and pass to the core via the new
  `core.mount(server, { assetsDir })` option.

  Highlights:

  - **`@node-xray/dashboard`** is now a real package. It contains a
    faithful port of the v4.1 mockup (top bar with live event-loop
    lag, requests sidebar with filters, runtime tab with call stack /
    Node APIs / event loop / macro+micro queues / async waterfall /
    timeline / async grid, body inspector tab with request+response
    panels, aggregate stat bar, pause / clear / sort controls)
    rendered by a vanilla-JS WebSocket client that consumes the
    `@node-xray/types` wire protocol. No framework, no build step.
  - **`@node-xray/core`** serves the assets synchronously from memory,
    replacing the inline redirect placeholder. The mount API now
    accepts `{ assetsDir }`; when omitted the route returns a 503
    install hint so dashboards still load gracefully.
  - **`@node-xray/express`**, **`@node-xray/fastify`**, and
    **`@node-xray/nestjs`** each declare `@node-xray/dashboard` as a
    runtime dependency and pass `getAssetsDir()` through to the core
    on first request. The inline `DASHBOARD_HTML` placeholders are
    gone; the first request to the dashboard path returns the
    real UI.
  - New tests: 9 dashboard asset / wire-protocol sanity tests and 3
    core mount-with-assetsDir tests cover the new surface.

- f962858: # p6 — hardening

  **Security**

  - **Redaction deny list expanded.** The default `redactHeaders` now
    covers 24 sensitive headers (was 14): adds `www-authenticate`,
    `proxy-authenticate`, `cookie2`, `x-auth-token`, `x-access-token`,
    `x-refresh-token`, `x-id-token`, `x-session-id`, `x-csrf-token`,
    `x-xsrf-token`. The default `redactBodyPaths` now covers 22 sensitive
    field names (was 10), including `passwd`, `pwd`, `apiKey`/`api_key`,
    `accessToken`/`access_token`, `refreshToken`/`refresh_token`,
    `idToken`/`id_token`, `sessionId`/`session_id`, `authorization`,
    `privateKey`/`private_key`, `cvv`, `pin`, `creditCard`/`credit_card`,
    `ssn`, `phone`. Cards[].pin is also masked.
  - **Opt-out for full fidelity.** `XRayOptions.redactHeaders` and
    `redactBodyPaths` now accept `false` to disable the default deny
    list for users in trusted environments.
  - **Dashboard HTTP endpoint is auth-gated.** Previously only the
    WebSocket upgrade required credentials; the dashboard HTML, JS, and
    CSS were served unauthenticated. They now go through the same
    `authorize()` check as the WS path. Unauthenticated requests get
    `401 Unauthorized` with `WWW-Authenticate: Basic realm="node-xray"`.
  - **CSP tightened.** `script-src 'self'` (no `'unsafe-inline'`). Added
    `form-action 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`.
    Added `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy:
same-origin`, `Cross-Origin-Resource-Policy: same-origin`. All three
    adapters (Express, Fastify, NestJS) and core's own listener use the
    same `applyDashboardSecurityHeaders()` helper for consistency.
  - **Auth errors funnel through `onError`.** A new `MountOptions.onError`
    hook receives unexpected internal errors (e.g. a custom `verify`
    function that threw) so they surface in observability rather than
    becoming unhandled rejections. The HTTP response is `500 Internal
Server Error`.

  **Performance & reliability**

  - **Perf bench.** `pnpm bench` (in the new private `@node-xray/bench`
    package) runs 5000 requests + 500 warmup against an Express server
    with and without `@node-xray/express`. Reports rps, mean, p50/p95/p99
    latency, and overhead.
  - **Soak test.** `packages/express/src/soak.test.ts` fires 5 batches of
    200 requests across 5 different routes (GET, POST, slow, error, 404)
    and asserts that the ring buffer stays bounded at 50 entries and
    heap growth is under 25 MB. The test passes on Node 20/22/24.

  **Documentation**

  - `docs/SECURITY.md` now includes the full redaction table, the full
    CSP table with all directives and what each one blocks, and a
    dedicated "HTTP dashboard endpoint also requires auth" section.

  **Test count:** 161 (was 150). Breakdown: types 11, core 90, dashboard
  9, express 20, fastify 17, nestjs 14.

  **Coverage:** core 81.2%/82%, express 88.4%/70.5%, fastify 82.1%/76%,
  nestjs 83.4%/62.6%, types & dashboard/src 100%.

### Patch Changes

- e64095e: # fix — adapters: resolve dashboard assets via createRequire

  The express, fastify, and nestjs adapters were calling
  `getAssetsDir()` from `@node-xray/dashboard` to locate the
  dashboard's `assets/` directory. tsup inlined that function
  into the consumer's dist at build time, which broke the
  `__filename` / `import.meta.url` resolution inside it. The
  function then returned a path relative to the WRONG file, and
  the dashboard silently fell back to a "not installed"
  placeholder.

  **Fix**

  Each adapter now resolves the assets directory itself, using
  `createRequire(import.meta.url)` to find the dashboard's
  main entry at runtime (in the adapter's own context, not the
  bundled one). The path is then computed as
  `<mainEntry>/../../assets/`, which works in both monorepo
  (source) and published (dist / `node_modules`) layouts.

  The dashboard's `package.json` is not reachable via
  `require.resolve('@node-xray/dashboard/package.json')` because
  its `exports` field does not include it; the main entry is the
  only thing that is always reachable.

  **Additional express fix**

  The express middleware serves the dashboard HTML and then
  returns early, which meant `tryMountDashboard` never ran and
  the core's `request` listener was never added. The static
  assets (`app.js`, `styles.css`) returned 404 because the core
  listener that serves them was not registered. The middleware
  now calls `tryMountDashboard` after writing the dashboard
  response, so the listener is in place for subsequent requests.

  **Verified**

  - `pnpm -r test` → 162/162 (was 162/162).
  - `examples/express-basic` now serves the real 10,437-byte
    v4.1 dashboard HTML with all CSP / X-Frame-Options / COOP /
    CORP headers.
  - `examples/express-basic` now serves `/_xray/app.js` and
    `/_xray/styles.css` with the correct MIME types.

- 75306bb: Fix CI coverage job: add `@vitest/coverage-v8` as a per-package dev
  dependency and add a `test:coverage` script that runs vitest with
  `--coverage --passWithNoTests`. The previous `pnpm -r test -- --coverage`
  invocation failed because the v8 coverage provider is a separate
  package that was not declared anywhere.

  This is a tooling-only fix. No runtime API changes.

- b9e8770: # p7.1 — express adapter: fix ERR_HTTP_HEADERS_SENT race

  The express adapter's middleware serves the dashboard HTML and then
  `core.mount()` adds a `'request'` listener to the same http.Server
  that also tries to handle the dashboard path. Both ran; the
  middleware ended the response, then the core's listener tried to
  call `res.setHeader(...)` and threw `ERR_HTTP_HEADERS_SENT`.

  **Fix**

  After the middleware sends the dashboard HTML, it now neutralizes
  `res.setHeader` and `res.end` on the response so the core's listener
  is a no-op when it runs after. This matches the pattern already
  used by the NestJS interceptor (`packages/nestjs/src/interceptor.ts`).

  **Regression test**

  `packages/express/src/index.test.ts` now has a test that drives a
  real `http.Server` and asserts both the 200 response and that
  `server.on('clientError', ...)` never fires.

  **Test count:** 162 (was 161). No other behavior change.

- Updated dependencies [75306bb]
- Updated dependencies [521c9be]
- Updated dependencies [3a9b6fd]
- Updated dependencies [2f7c27f]
- Updated dependencies [f962858]
  - @node-xray/core@0.3.0
  - @node-xray/types@0.2.0
  - @node-xray/dashboard@0.2.0
