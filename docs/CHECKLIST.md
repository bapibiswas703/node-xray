# Production-grade checklist

> **Last updated:** 2026-07-07 (commit `feb2ba5`, the v1.0 release; stats-frame emitter lands on `feat/stats-frame`) · Companion: [implementation.md](./implementation.md) — the detailed status behind every box here.
>
> Definition of **10/10**: every advertised feature works and is verified at runtime; no option is silently ignored; no documented API is missing; the release pipeline publishes hands-free; and a stranger can go from `npm install` to a fully live dashboard without hitting a single dead panel.
>
> **Current score: 7.5/10.** The capture pipeline, context propagation, security model, packaging, dashboard fundamentals, and now the status-bar telemetry are production-grade and regression-tested. The remaining gap to 10 is: the timeline / async-op / waterfall panes (still empty), the event-loop phase / metrics correctness, the silently-ignored options, the doc drift, and the npm publish (now unblocked, see §8).

Legend: `[x]` done & verified · `[ ]` open. Every open box lists its acceptance criterion — a box is only checked when that criterion is _observed at runtime or enforced by a test_, not when code merely exists.

---

## 1. Core runtime

- [x] Ring-buffer store: FIFO eviction, hard caps, single-writer, subscriber snapshots, `clear()`; soak-tested
- [x] AsyncLocalStorage context: one ALS instance process-wide; `getContext` / `getContextOrThrow` / `withTags` / `withContext` / `runWithContext`; tags persist to records via `RECORD_TAGS_REF`
- [x] Config resolution: defaults, clamps, redaction merges, specific `XRayConfigError`s, production auth guard, default ignore (favicon, dashboard paths, Chrome DevTools probes)
- [x] Redaction: default-deny headers, JSON-path body walker (any-depth wildcards, arrays, cycles, depth limit), size truncation with markers
- [x] Event bus: typed, synchronous, recursion-bounded, listener-error-isolated
- [x] Zero runtime dependencies besides `ws` and `@node-xray/types` (enforced by packaging tests)
- [ ] **Event-loop metrics correctness** — accept: `utilization` computed via `performance.eventLoopUtilization(current, previous)`; `lagMs` is a real per-interval measure (p50 of the interval, not `(min+max)/2`); docs match the actual window semantics
- [ ] **Event-loop phase** — accept: phase is genuinely detected, or the field reports `'unknown'`, the dashboard ring degrades gracefully, and README stops listing phases as a feature
- [ ] **`sampleRate` honored** — accept: at `0.5`, ~half of requests are recorded (statistical test), ignored requests cost no record allocation; or the option is **removed** from types + CONFIGURATION.md
- [ ] **`websocket.enabled: false` honored** — accept: hub never constructed, no upgrade listener bound, dashboard route still explains why; or the option is removed
- [ ] **Version truth** — accept: `hello.server.version` and `VERSION` derive from package.json at build time; adapters report their real framework name

## 2. Telemetry producers (the big gap)

- [x] **`stats` frame** — accept: broadcast every 500 ms with real `reqCount`/`errors`/`avgMs`/`loopLagP99`/`poolBusy`/`poolSize`/`backpressureDropped`; dashboard "dropped" tile moves when a slow client forces drops; contract test in `ws.test.ts`. Implemented in `packages/core/src/stats.ts` (the `createStatsEmitter`) wired into `createCore`; the hub forwards the frame; the dashboard's `app.js` consumes it via a new `case 'stats':` in `handleFrame` and `renderStatusBar` writes the bar from `state.stats`. Contract test in `packages/core/src/ws.test.ts` ("forwards stats events to every connected client as a `stats` frame"). `reqCount` and `errors` are cumulative since process start (or last `clear`); `avgMs` is a rolling-100 mean; `poolSize` is read once from `process.env.UV_THREADPOOL_SIZE` (default 4).
- [ ] **Thread-pool signal** — accept: `UV_THREADPOOL_SIZE` read at startup; `threadMark()` wired to at least the built-in span API below; `record.thread` populated; `0/0` never shown on an active pool. Partial: `UV_THREADPOOL_SIZE` plumbing landed with the stats frame (the tile now reads `0/4` instead of `0/0`); `threadMark()` and `record.thread` remain ungated on the span API (P1 #6).
- [ ] **Request timeline** — accept: adapters emit lifecycle entries (received → handler → serialize → sent) so `timeline` is non-empty for every request; caps + `__truncated` marker enforced; dashboard section renders real data
- [ ] **Async operations / waterfall** — accept: a public span API (`measure(label, fn)` or equivalent) records `AsyncOp`s under the active context without monkey-patching Node internals; example apps demonstrate it; waterfall renders real spans
- [ ] **Meaningful stacks** — accept: stack captured at a point that reflects the handler (or feature descoped from README); non-sampled requests get the documented shim + "sampled" badge, or `stack.rate` docs are corrected

## 3. Adapters

- [x] Express: middleware capture, body interception, error middleware, route patterns, dashboard routes (auth-gated), ALS wiring, `enabled:false` no-op
- [x] Fastify: plugin (fastify-plugin, v4/v5), hook-based capture, dashboard routes incl. assets + 426 on plain `/ws` GET (auth-gated), ALS wiring, `enabled:false` no-op
- [x] NestJS: dynamic module (`register`/`registerAsync`), global interceptor, injectable `XRayService`, dashboard serving on Express platform, ALS wiring (eager `next.handle()` handled), `enabled:false` no-op
- [ ] **NestJS `durationMs`** — accept: real hrtime-based duration on every record; test asserts `> 0`
- [ ] **`@XRayTrace()` does something** — accept: decorated methods appear as spans/tags on the record (depends on §2 span API); or the decorator is removed from exports
- [ ] **NestJS first-request dashboard** — accept: `GET <path>` works even when it is the very first request the server receives (mount is currently lazy; today the first-ever hit 404s, works from the second)
- [ ] **NestJS + Fastify platform dashboard** — accept: integration test proves HTML/assets/WS on `@nestjs/platform-fastify`, not just the Express platform

## 4. Wire protocol & dashboard

- [x] Versioned frames; snapshot replay; reconnect backoff; `maxClients`; per-client backpressure dropping
- [x] Client frames: `ping`, `clear` (server-side clear, all-tab sync, reload-proof); malformed input dropped safely; real-socket contract tests
- [x] Dashboard fundamentals: request list, filters, sorting, pause, clear, Request/Response inspector with redacted headers + JSON viewer, full-viewport layout, `no-cache` assets, custom-path support, empty-state placeholders, null-safe renderers
- [ ] **No dead UI** — accept: once §2 lands, every panel (call stack, libuv, queues, waterfall, timeline, async grid, phase ring, pool + dropped tiles) renders real data in the example apps; anything that can't must be removed from the UI
- [ ] **Update coalescing honesty** — accept: either `request:update` coalescing (16 ms) is implemented as EVENTS.md describes, or EVENTS.md stops describing it
- [ ] **Documented backoff matches code** — accept: EVENTS/ARCHITECTURE say 15 s cap (code) or code moves to 30 s (docs) — one of them, everywhere

## 5. Security

- [x] Default-deny header + body redaction (opt-out only by explicit `false`)
- [x] Auth (`basic`/`bearer`/`custom`) on HTML, assets, and WS upgrade in **all** serving paths; 401 + `WWW-Authenticate`; custom-verify exceptions → 500 via `onError`
- [x] Production refuses to mount without auth (specific startup error)
- [x] CSP, `X-Frame-Options: DENY`, `nosniff`, COOP/CORP, referrer-policy on dashboard responses
- [x] Same-host origin check on WS upgrade; path-traversal guards on asset routes (runtime-verified)
- [ ] **Constant-time credential comparison** — accept: `crypto.timingSafeEqual` over byte buffers (current home-grown compare leaks length and compares UTF-16 units)
- [ ] **Third-party review pass** — accept: SECURITY.md threat model re-validated against the _current_ code by someone who didn't write it

## 6. Failure isolation & robustness

- [x] Crash-proof dashboard listener (`headersSent` guards, try/catch → `onError`); single-writer dashboard responses in Express/Fastify
- [x] Muted core unreachable from adapters; `enabled:false` produces zero noise
- [x] Bus/store subscriber errors contained; WS failure cannot touch the HTTP server
- [ ] **Hub upgrade ordering** — accept: URL match checked _before_ `maxClients`, so 4 open dashboard tabs can never destroy an unrelated WebSocket upgrade on the host app (regression test with a user WS server on the same port)
- [ ] **Silent-cap markers** — accept: timeline/asyncOps/stack caps attach a `__truncated` indicator as ARCHITECTURE.md promises (currently only bodies do)

## 7. Packaging & distribution

- [x] Dual ESM+CJS, externals correct, `skipNodeModulesBundle` banned, `rxjs` declared as NestJS peer — all enforced by `packaging.test.ts`
- [x] Every dist `require()`s cleanly from its own package context; verified against real installs
- [x] Examples and bench `private: true` (unpublishable)
- [ ] **Consumer-install E2E in CI** — accept: a CI job packs the tarballs, installs them into a fresh project with **npm and pnpm**, boots a server, and asserts dashboard + WS work (this is the class of failure unit tests structurally cannot catch)

## 8. Release & operations

- [x] Changesets flow: every user-facing change carries a changeset; Version-Packages PR merged (core 0.4.0, express/fastify/nestjs 0.3.0, dashboard 0.2.2)
- [x] Release workflow YAML valid (was broken since 2026-06-24: `env` nested inside `with` — every run failed at 0 s; fixed in `b9b80a5`)
- [ ] **npm publish unblocked** — accept: publish succeeds from CI. Action required on npmjs.com (token demands OTP): either configure **Trusted Publishing** (GitHub Actions OIDC, per package — preferred, no secret at all) or mint a granular automation token without 2FA-on-publish and update the `NPM_TOKEN` secret; then re-run the failed release
- [ ] **Post-publish smoke** — accept: after each publish, `npm install` of the published versions in a clean project boots and serves the dashboard (scripted, ideally in the release workflow)

## 9. Documentation honesty

- [x] EVENTS.md matches the wire (incl. client frames); CONTRIBUTING/ARCHITECTURE packaging guidance matches tsup reality; implementation.md + this checklist exist and are dated
- [ ] **API.md matches exports** — accept: `getStore`/`getRequest`/`listRequests`/`clearStore`/`getLoopStats` exist, or API.md documents only real exports
- [ ] **README claims ≤ implementation** — accept: every bullet in README's feature list maps to a checked box in this file; phases/waterfall/pool bullets removed or reworded until §2 lands
- [ ] **CONFIGURATION.md matrix truthful** — accept: no option documented as working while ignored (`sampleRate`, `websocket.enabled`, `stack.rate` badge)
- [x] "Zero deps" claim scoped honestly (core: `ws` + types only)

## 10. Quality gates (standing, all currently green)

- [x] `pnpm -r typecheck` · `pnpm lint --max-warnings=0` · `pnpm format:check` · `pnpm -r build` · 198/198 tests
- [x] CI matrix Ubuntu + Windows × Node 20.18/22.11/24.x
- [x] Coverage thresholds 85/85/80/85 enforced
- [ ] **Coverage blind spot closed** — accept: adapter logic no longer lives in coverage-excluded `index.ts` files (extract to `middleware.ts`/`plugin.ts`/…), or the exclusion is narrowed to true barrels
- [ ] **Runtime verification in CI** — accept: the real-server smoke drives (dist require, dashboard fetch, WS hello/snapshot, auth 401/200, custom path) run as a CI job, not only ad hoc

---

## Score math

| Area                                                                | Weight | Status                                                                                           |
| ------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| Capture, context, storage, protocol, security, isolation, packaging | 7      | **Earned** — implemented, tested, runtime-verified                                               |
| Telemetry producers (§2) + dead-UI removal                          | 1.5    | Partial — `stats` frame + `UV_THREADPOOL_SIZE` landed; timeline/async ops/waterfall/phase remain |
| Options/doc honesty (§1 tail, §9) + small fixes (§3, §5, §6 tails)  | 1      | Open — mostly small, high-value                                                                  |
| Release fully hands-free (§8) + CI E2E (§7, §10 tails)              | 0.5    | Mostly earned — npm publish unblocked; CI E2E and consumer-install E2E still open                |

**7.5 / 10 today → 10 / 10 when every open box above is checked.** Rule of the road: a box never gets checked by "the code exists" — only by the stated acceptance criterion passing at runtime or in CI.
