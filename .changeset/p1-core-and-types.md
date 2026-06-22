---
'@node-xray/core': minor
'@node-xray/types': minor
---

Add the full P1 implementation of `@node-xray/types` and `@node-xray/core`.

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
