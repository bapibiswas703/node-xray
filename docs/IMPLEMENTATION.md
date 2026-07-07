# Implementation status

> **Last updated:** 2026-07-07 (commit `feb2ba5`, the v1.0 release; stats-frame emitter lands on `feat/stats-frame`) · Companion: [checklist.md](./checklist.md) — the scored path to a production-grade 1.0.
>
> This document is the honest map of what `node-xray` actually does today versus what the docs, types, and dashboard UI advertise. Every claim below was verified against the source and, where marked, at runtime (real servers, real WebSocket clients, headless-browser screenshots, built `dist/` artifacts). If a feature is listed as unimplemented, do not build on it and do not document it as working.

---

## 1. Fully implemented and verified

### Request capture pipeline (all three adapters)

- Express middleware, Fastify plugin, and NestJS interceptor each hook the framework lifecycle, create a `RequestRecord`, capture method/path/route/status/duration, and finalize on response completion. Verified end-to-end over real HTTP.
- Request/response **body capture** with parsed-body preference (Express `res.json`/`send`/`write`/`end` interception; Fastify `preSerialization`/`onSend`; NestJS observable tap), binary detection, and `maxBodySize` truncation with `{ __truncated, originalSize }` markers.
- **Error capture**: Express `errorHandler` middleware, Fastify `onError` hook (v5) with `setErrorHandler` fallback (v4), NestJS observable error path. Errors are serialized (`name`/`message`/`stack`) onto the record.
- **Route patterns**: Express `req.route.path` (+`baseUrl`), Fastify `routeOptions.url`, NestJS Express-route or `Class.handler` fallback.

### AsyncLocalStorage request context

- All three adapters wrap downstream execution in the request context: `getContext()` returns the live context inside handlers, across `await`, `setTimeout`, and nested callbacks. Verified at runtime including across the package boundary (user code importing `@node-xray/core` separately from the adapter sees the same ALS instance).
- `withTags()` is lexically scoped **and** persists tags to the finished record via the `RECORD_TAGS_REF` accumulator (`ctx.tags` is the record's own tag object). Direct `getContext().tags.x = y` writes also land on the record.
- NestJS subtlety (regression-tested): `next.handle()` starts the route handler eagerly when _called_, so both the call and the subscription happen inside `runWithContext`.

### Storage

- In-memory FIFO ring buffer (`RequestStore`), default 200 records, hard `maxRequests` eviction, single-writer/multi-reader, subscriber snapshots, `clear()`. Soak-tested for leak-free behavior under sustained load.
- Per-record caps enforced at write time: timeline 500, asyncOps 200 (both currently moot — see §3), stack 20 frames, body 100 KB.

### Wire protocol (server → client)

- Versioned JSON frames over WebSocket at `<path>/ws`: `hello` (config + server info), `snapshot` (replayed on connect/reconnect), `request:new`, `request:update`, `request:done`, `loop`, `error`. See [EVENTS.md](./EVENTS.md).
- **Client → server frames** (added 2026-07-07): `{v:1,t:'ping'}` heartbeat and `{v:1,t:'clear'}` — clears the server-side ring buffer and rebroadcasts an empty snapshot to **all** connected tabs, so clears survive reloads. Malformed/unknown frames are dropped without harming the socket. Covered by real-socket contract tests (`packages/core/src/ws.test.ts`).
- Backpressure: frames dropped per-client when `bufferedAmount` ≥ 1 MB; drop counter kept (but not yet surfaced — see §3).
- `maxClients` cap on concurrent dashboard connections.

### Dashboard (working parts)

- Live request list with method/status/duration, filters (all/2xx/4xx/5xx/err/>50ms), sorting (newest/slowest/errors-first), pause/live toggle, clear (server-side), reconnect with exponential backoff and snapshot replay.
- Request/Response tab: headers (redacted), pretty-printed JSON bodies, sizes, copy buttons.
- Stats bar computed client-side: total / 2xx / errors / avg / loop lag.
- Layout fills the browser viewport; assets served with `cache-control: no-cache` so browsers can never hold a stale bundle; the client derives its mount path from `location.pathname`, so **custom `path` values work** with zero configuration.
- Chrome DevTools `/.well-known/appspecific/` probes ignored by default (no 404 noise).

### Security

- **Redaction, default-deny**: 16 sensitive header names replaced with `[REDACTED]`; ~40 default JSON-path body rules (credentials, tokens, payment, PII; wildcard `*.field` matches at any depth — runtime-verified to depth 4+), cycle- and depth-limited walker. Opt-out requires explicit `false`.
- **Auth** (`basic` / `bearer` / `custom verify`) enforced on: dashboard HTML, `app.js`/`styles.css`/assets (in every adapter), and the WebSocket upgrade. 401 + `WWW-Authenticate` on failure; a throwing custom `verify` becomes a 500 via `onError`, never an unhandled rejection.
- **Production guard**: refuses to start with `NODE_ENV=production` unless `auth` is configured (specific `XRayConfigError`).
- CSP / `X-Frame-Options: DENY` / `nosniff` / COOP / CORP on dashboard responses; same-host origin check on WS upgrade; path-traversal guards on asset routes (runtime-verified with raw un-normalized requests).
- `enabled: false` is a true no-op in every adapter: no routes, no records, no `onError` noise.

### Failure isolation

- Core's dashboard listener is crash-proof: `headersSent` guards + try/catch around every write, errors funneled to `onError`. (A double-writer race on NestJS could previously kill the host process with an uncaught `ERR_HTTP_HEADERS_SENT`; regression-hardened 2026-07-05.)
- Express/Fastify own their dashboard routes outright (`serveHttp: false` mount) — exactly one writer per response.
- Event-bus listeners and store subscribers are try/caught; WS failures never touch the HTTP server.

### Packaging & distribution

- Dual ESM+CJS output via tsup; workspace packages and `ws` externalized (tsup's `skipNodeModulesBundle` is banned — it force-bundles anything matched by tsconfig `paths` _before_ `external` is consulted, which used to inline a private copy of core into every adapter and crash consumers on an undeclared `require('ws')`).
- `rxjs` is a declared NestJS peer dependency.
- Enforced by `packages/core/src/packaging.test.ts`: every bare require in every dist must be a Node builtin or a declared dependency/peerDependency; no adapter may contain `AsyncLocalStorage` (i.e. an inlined core).

### Test & CI infrastructure

- 198 tests across 16 files; adapters tested against the real frameworks (supertest / `fastify.inject` / `@nestjs/testing`); WS contract tests with real sockets; packaging tests against built dists; Express soak test; coverage thresholds 85/85/80/85 in CI.
- CI matrix: Ubuntu + Windows × Node 20.18 / 22.11 / 24.x — green.
- Release automation (changesets → version PR → publish with npm provenance): workflow YAML fixed 2026-07-07 (`env` was nested inside `with`, so **every** release run since 2026-06-24 failed at startup). Publishing currently blocked on the npm token requiring OTP — see [checklist §8](./checklist.md).

---

## 2. Partially implemented (works, with caveats)

| Feature                          | What works                                                                              | The caveat                                                                                                                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Call stack capture**           | Sanitized, node_modules-stripped, frame-capped, 10% sampled by default                  | Captured only at request start (the middleware call site), so it shows where the request _entered_, not the handler's own stack. The other 90% of requests get nothing — no shim stack, no "sampled" badge, contrary to CONFIGURATION.md |
| **Event-loop lag / utilization** | `monitorEventLoopDelay` sampled every 500 ms, broadcast as `loop` frames, rendered live | `lagMs = (min+max)/2` is not "current per-tick lag"; utilization subtracts cumulative ELU ratios instead of using `eventLoopUtilization(current, previous)`; the "1-second rolling window" is actually a 500 ms tumbling window          |
| **`hello` server info**          | Frame sent with node version, pid, uptime                                               | `version` is hardcoded `'0.2.0'` (core is 0.4.0) and `framework` is hardcoded `'node-xray'` — the dashboard's host label is wrong                                                                                                        |

---

## 3. Unimplemented (typed/documented/visible in UI, but no producer)

Do not claim these work. Each needs the linked change or should be descoped from README/docs.

1. **Request timeline** — `TimelineEntry`, the 500-entry cap, `request:update` coalescing docs, and the dashboard's "request timeline" section all exist; `addTimeline` has **zero callers**. Every record ships `timeline: []`.
2. **Async operations / waterfall** — same shape: `AsyncOp` type, caps, two dashboard panels; `addAsyncOp` has zero callers. Needs a public span API (e.g. `measure(label, fn)`) plus adapter-emitted lifecycle entries — monkey-patching Node internals is banned by the architecture guardrails, so instrumentation must be explicit.
3. **`stats` wire frame** — ✅ **DONE (2026-07-07).** `createStatsEmitter` in `packages/core/src/stats.ts` aggregates on a 500 ms cadence; the hub forwards the frame; the dashboard's `app.js` consumes it via `case 'stats'` in `handleFrame` and `renderStatusBar` writes the bar from `state.stats`. The `st-drop` tile is now live (`backpressureDropped` is plumbed end-to-end). `reqCount` and `errors` are cumulative since process start (or last `clear`); `avgMs` is a rolling-100 mean; `poolSize` is read once from `process.env.UV_THREADPOOL_SIZE` (default 4). The `clear` client frame resets the cumulative counters via a new `onClear` hook on the hub. Contract test in `packages/core/src/ws.test.ts`. Pool tile now reads `0/4` instead of `0/0` even with no adapters calling `threadMark`.
4. **Thread-pool utilization** — partial (with item 3). `UV_THREADPOOL_SIZE` plumbing landed; `threadMark()` and `record.thread` are still ungated on the span API (item 2 above). When the span API lands, adapters that wrap synchronous work hitting libuv's thread pool should call `threadMark(true/false)` around it.
5. **Event-loop phase** — `detectEventLoopPhase()` returns `'poll'` unconditionally (its feature-check is true on every Node version). The phase ring is a constant. Implement honestly or report `'unknown'`.
6. **`sampleRate` option** — accepted, clamped, never consulted; every request is recorded at any value.
7. **`websocket.enabled: false`** — ignored; the hub is always created and attached.
8. **NestJS `durationMs`** — hardcoded `0` (`packages/nestjs/src/interceptor.ts`); latency stats are wrong for every NestJS app. Trivial fix: capture `hrtime.bigint()` at intercept.
9. **`@XRayTrace()` decorator (NestJS)** — sets `XRAY_TRACE_KEY` metadata that nothing reads. Pure no-op.
10. **Phantom API surface** — [API.md](./API.md) documents `getStore()`, `getRequest()`, `listRequests()`, `clearStore()`, `getLoopStats()` as `@node-xray/core` exports; none exist. Either add the five small wrappers or fix API.md.

---

## 4. Recommended implementation order

1. `stats` frame emitter (small; makes the status bar, dropped counter, and pool display real once §3.4 lands) → **DONE 2026-07-07** (`packages/core/src/stats.ts`, contract test in `ws.test.ts`).
2. NestJS `durationMs` (trivial) →
3. `sampleRate` + `websocket.enabled` (implement or remove — the "no silent fallbacks" guardrail argues removal until real) →
4. API.md reconciliation (§3.10) →
5. Version/`hello` drift (§2 row 3; derive from package.json at build time) →
6. Timeline + async ops via an explicit span API (§3.1–2 — the one genuinely large feature) →
7. Event-loop phase + stack-capture honesty (§3.5, §2 row 1): implement properly or descope from README.

The scoring and acceptance criteria for all of this live in [checklist.md](./CHECKLIST.md).
