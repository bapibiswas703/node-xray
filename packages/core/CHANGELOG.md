# @node-xray/core

## 0.4.0

### Minor Changes

- 88305f1: Dashboard "clear" now clears the server-side ring buffer too — previously it only wiped the browser's copy, so reloading the page brought the whole history back from the snapshot. The client sends a `{ v: 1, t: 'clear' }` frame; the server empties the store and rebroadcasts an empty snapshot to every connected tab (documented in docs/EVENTS.md, covered by new WS contract tests). Malformed or unknown client frames are dropped without affecting the socket.

  Dashboard layout polish: the page now fills the full browser viewport (an unsized `html`/`body` chain made the root collapse to its 600px min-height, leaving dead space below), the root's border-radius is removed, and the Runtime panels show muted placeholder hints ("select a request to inspect", "idle") instead of blank canvas when no request is selected.

  Fix a long-standing dashboard crash: the reset path emptied `#loop-box`, deleting the Event Loop ring and labels from the DOM, so every `loop` frame (twice a second) threw `TypeError: Cannot set properties of null` in `renderLoop` and the Event Loop panel rendered as an empty rectangle. The loop box is no longer cleared (it is process telemetry, not per-request state) and `renderLoop` is null-safe.

  Dashboard assets are now served with `cache-control: no-cache` in the Express and Fastify adapters (previously `max-age=3600`) — an hour-long browser cache kept stale, crashing bundles alive across dashboard updates until a hard refresh.

- 52b70ca: Fix five critical defects found in an internal implementation audit:

  - **Packaging**: tsup no longer inlines `@node-xray/core` into adapter dists (pnpm workspace symlinks defeated `skipNodeModulesBundle`, shipping a private copy of core and an undeclared `require('ws')` that crashed the published fastify/nestjs packages under pnpm). Workspace packages and `ws` are now externalized; `rxjs` is a declared NestJS peer dependency; packaging regression tests parse each dist and verify every bare require is declared.
  - **AsyncLocalStorage context**: all three adapters now wrap downstream execution in the request context — `getContext()` works inside handlers (across `await` and timers), and `withTags()` tags persist onto the finished `RequestRecord` via the new `RECORD_TAGS_REF` accumulator.
  - **Custom `path`**: the dashboard client derives its WebSocket endpoint from `location.pathname` instead of a hardcoded `/node-xray`, so custom mount paths (e.g. the examples' `/_xray`) get live data.
  - **Auth**: the dashboard HTML and static assets served by the Express middleware, Fastify routes, and NestJS listener are now gated by the configured `auth` (401 + `WWW-Authenticate` for basic). Core gains `verifyDashboardAuth()` and a `serveHttp: false` mount option so exactly one writer owns each dashboard response.
  - **`enabled: false`**: Express and Fastify adapters are true no-ops when disabled — no more per-request `onError` spam from the muted core.

### Patch Changes

- d77d8d5: Ignore Chrome DevTools' `/.well-known/appspecific/` probe requests by default — with DevTools open, Chrome fires one per page load and each showed up in the dashboard as a 404, polluting the request list and error count.

## 0.3.0

### Minor Changes

- 521c9be: Add the full P1 implementation of `@node-xray/types` and `@node-xray/core`.

  `@node-xray/types` now exports the complete public type surface:
  `XRayOptions`, `XRayContext`, `RequestRecord`, `TimelineEntry`, `AsyncOp`,
  `LoopStats`, `EventLoopPhase`, the versioned `WireFrame` discriminated
  union, and the `XRayError` hierarchy. Zero runtime dependencies.

  `@node-xray/core` ships the runtime engine:

  - `createCore(options)` factory that adapters consume
  - `AsyncLocalStorage`-backed context with `getContext`, `getContextOrThrow`,
    `withTags`, `withContext`
  - A typed event bus with bounded re-entrancy
  - An event-loop monitor using `perf_hooks.monitorEventLoopDelay`
  - A sanitized, sampled stack-capture helper
  - A default-deny header redactor and a JSON-path body redactor with
    cycle and depth detection
  - A bounded in-memory ring buffer (`RequestStore`) with FIFO eviction,
    single-writer/multi-reader semantics, and subscriber broadcasts
  - A versioned WebSocket hub with backpressure handling, `Origin`
    allowlist, basic/bearer/custom auth, and CSP-aware HTTP mounting
  - Production guard: refuses to mount in `NODE_ENV=production` without
    an `auth` block

  Unit tests cover all modules (87 tests, all passing).

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

- 75306bb: Fix CI coverage job: add `@vitest/coverage-v8` as a per-package dev
  dependency and add a `test:coverage` script that runs vitest with
  `--coverage --passWithNoTests`. The previous `pnpm -r test -- --coverage`
  invocation failed because the v8 coverage provider is a separate
  package that was not declared anywhere.

  This is a tooling-only fix. No runtime API changes.

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

- Updated dependencies [75306bb]
- Updated dependencies [521c9be]
- Updated dependencies [3a9b6fd]
- Updated dependencies [f962858]
  - @node-xray/types@0.2.0
