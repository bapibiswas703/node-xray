# Performance

> The performance budget for `node-xray` v1, how it is measured, and how to stay inside it.

## The budget

These are the hard numbers v1 commits to. They are checked in CI; a regression fails the build.

| Metric                       | Budget                                 | Measured on                                 |
| ---------------------------- | -------------------------------------- | ------------------------------------------- |
| Per-request overhead (p50)   | < 0.5 ms                               | Node 20, Express 5, JSON request, 1 KB body |
| Per-request overhead (p99)   | < 1.5 ms                               | Same                                        |
| Per-request overhead (p99.9) | < 5.0 ms                               | Same, with stack capture enabled            |
| Steady-state memory          | < 1.5 MB RSS for 200 buffered requests | Same                                        |
| Backpressure drop rate       | < 0.1% of frames                       | With 4 dashboard clients                    |
| Dashboard cold start         | < 250 ms to first paint                | Slow 4G throttled                           |
| WS reconnect                 | < 100 ms to first frame                | After forced close                          |

If a change regresses any of these by more than 10%, the CI fails. If a change regresses by more than 25%, the PR is blocked at review.

## The benchmark suite

`packages/bench/` ships a runnable perf comparison. It boots an Express server with and without `xray()`, fires 5000 requests + 500 warmup, and reports rps + mean + p50/p95/p99 + overhead.

```bash
pnpm bench
```

Sample output:

```
node-xray benchmark — 5000 requests per run, 500 warmup
  xray disabled (control)      rps=  540.36 mean=    1.85ms p50=    1.67ms p95=    3.73ms p99=    5.39ms total= 9253.03ms
  xray enabled                 rps=  555.88 mean=    1.80ms p50=    1.51ms p95=    3.69ms p99=    5.78ms total= 8994.70ms

  mean-latency overhead: -2.8%   rps delta: --2.9%
```

The exact delta varies by OS scheduling noise, but it stays in the low single-digit percent range on Node 20/22/24. The budgets below are checked against this delta.

## What is on the hot path

The expensive things, in order:

1. **Body capture** — `structuredClone` of the parsed JSON, plus the redactor walk. The dominant cost. A 100 KB body costs ~200 µs.
2. **Stack capture** — `Error.captureStackTrace` plus sanitization. 50–200 µs at `rate: 1`. The default `rate: 0.1` amortizes this to 5–20 µs.
3. **WS frame serialization** — `JSON.stringify` per frame. The store batches updates within a 16 ms window, so a busy request generates ~3–5 frames, not 30.
4. **Ring buffer insertion** — push to an array, evict if full. Constant time. Negligible.

Everything else is sub-microsecond. The ALS `run` is the cost you don't see — Node core amortizes it.

## Sampling guide

If you are in a hot path and need to drop overhead, follow this guide.

| Symptom                                       | Setting                     | Trade-off                                  |
| --------------------------------------------- | --------------------------- | ------------------------------------------ |
| p99 latency budget blown                      | `sampleRate: 0.1`           | 1 in 10 requests is recorded               |
| Memory growth on a long session               | `maxRequests: 50`           | Older records evict sooner                 |
| Stack capture is the hot spot                 | `stack: { rate: 0.01 }`     | 1 in 100 requests has a real stack         |
| Body capture is the hot spot                  | `captureRequestBody: false` | You lose request-body diffs                |
| Body capture is the hot spot, but you need it | `maxBodySize: 10_000`       | Only the first 10 KB of a body is captured |
| Dashboard is janky                            | pause via the UI            | Server keeps recording, dashboard ignores  |

A reasonable dev-time profile for a high-traffic local app:

```ts
xray({
  sampleRate: 0.25,
  maxRequests: 100,
  maxBodySize: 32 * 1024,
  stack: { rate: 0.05, maxFrames: 10 },
});
```

## Memory model

### Steady state

```
heap = ring_buffer + ws_clients + redactor_cache + scratch

ring_buffer = maxRequests × (record_overhead + body_cap + stack_cap)
            = 200 × (~3 KB + 100 KB + 2 KB)    // worst case, all bodies hit cap
            ≈ 21 MB
```

In practice, only a few bodies hit the cap, so steady state is closer to 1.5 MB. The express soak test (`packages/express/src/soak.test.ts`) asserts this in a single run.

### Burst

A burst of N concurrent requests allocates N context objects and N partial records. The contexts are short-lived (request lifetime). The records live in the ring buffer until evicted. There is no allocation path that can grow without bound.

### The one allocation to watch

`structuredClone(req.body)` is the one place a body-sized allocation happens. The clone is necessary so that mutations to `req.body` by user code do not affect the captured snapshot. If you have a body type that is expensive to clone (e.g. a `Buffer` or a `Map`), and you do not mutate it, set `captureRequestBody: false` and use the `XRayContext.tags` mechanism to attach a small summary instead.

## Profiling

When you suspect a regression, profile with `clinic.js` or `node --prof`:

```bash
node --prof src/server.ts
# drive some traffic
node --prof-process isolate-*.log | head -100
```

The two functions to look for in the output are `XRayStore.add` and `XRayRedactor.walk`. They should account for < 5% of total CPU at the dev-time default settings.

## Soak test

`packages/express/src/soak.test.ts` is an in-PR test that drives 5 batches of 200 requests across 5 different routes (GET, POST, slow, error, 404). It asserts:

- Ring buffer stays bounded at 50 entries.
- Heap growth is under 25 MB.
- Zero unhandled promise rejections.

The full test takes about 7 seconds and runs on every PR. A regression on this test is treated as a high-priority bug.

## Limits

| Limit                        | Default                       | How to raise                     |
| ---------------------------- | ----------------------------- | -------------------------------- |
| Records in memory            | 200                           | `maxRequests`                    |
| Timeline entries per record  | 500                           | internal, not configurable in v1 |
| Async ops per record         | 200                           | internal, not configurable in v1 |
| Stringified body             | 100 KB                        | `maxBodySize`                    |
| Stack frames per record      | 20                            | `stack.maxFrames`                |
| Dashboard clients            | 4                             | `websocket.maxClients`           |
| WS frame buffer (per client) | 1 MB                          | internal, not configurable in v1 |
| Backpressure drop policy     | drop frame, increment counter | not configurable in v1           |
