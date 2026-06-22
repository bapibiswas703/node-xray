# Roadmap

> What is in v1, what is intentionally out, and the order in which the out-list will be considered.

The shape of v1 is locked. Anything in this document is _not_ in v1 and is not promised for v2. We are explicit about scope because the Node.js tooling ecosystem is littered with packages that tried to do everything and did nothing well.

## v1.0 (this release)

The package family:

- `@node-xray/types`
- `@node-xray/core`
- `@node-xray/express`
- `@node-xray/fastify`
- `@node-xray/nestjs`
- `@node-xray/dashboard`

The feature set:

- AsyncLocalStorage-based request context propagation.
- Per-request call stack (sampled), request/response timeline, async operations.
- Event-loop lag and utilization sampling.
- Thread-pool utilization (advisory).
- In-memory ring buffer with bounded memory.
- WebSocket hub with snapshot replay and backpressure handling.
- Default-deny header redaction and JSON-path body redaction.
- Static dashboard with two tabs (Runtime, Request/Response) and the v4.1 visual design.
- Configurable auth (basic, bearer, custom) for non-dev environments.
- Refuse-to-mount in production without auth.
- Three runnable examples (Express, Fastify, NestJS) in JS and TS.
- Full documentation set.

## v1.1 (next minor)

Small additions, no breaking changes:

- Keyboard shortcuts in the dashboard (already wired in code, just needs the help modal).
- `?` opens the shortcut help.
- `pnpm dlx @node-xray/bench` — run the benchmark suite against a running app.
- A Vitest plugin (`@node-xray/vitest`) that auto-mounts the dashboard in test mode.
- Removal of the remaining inline `<style>` blocks in the dashboard (CSP cleanup).
- A `XRayContext.measure(label, fn)` helper for ad-hoc spans.

## v1.2 (later minor)

- Disk-backed ring buffer (SQLite, optional). The in-memory mode stays the default.
- Recording and replay. A `xray({ record: { path: './sessions' } })` option writes every frame to disk. A `xray replay <file>` command replays it.
- Custom adapters: documented recipe for Koa, Hapi, uWebSockets.js.

## v2.0 (next major)

This is where the scope starts to grow. The order is by user demand, not by technical interest.

### Multi-replica aggregation

The biggest v1 limitation: every replica has its own dashboard. In a 10-replica deployment, you cannot see the whole picture. v2 adds:

- A small `node-xray-hub` server you run alongside your app.
- Replicas push to the hub; the hub aggregates and serves the dashboard.
- The hub is stateless; multiple hubs can be run for HA.

### Production-safe mode

The v1 default of "off in prod" is the right default, but some teams want this in prod. v2 adds:

- Sampling defaults tuned for production traffic.
- A `redact-everything` mode that stores only metadata (no bodies, no headers, no stacks).
- An opt-in `--access-log` mode that emits a `xray:request:done` event per request for downstream consumers.
- A clear performance budget for prod: < 0.1 ms p99 overhead.

### Distributed tracing

The honest answer is "use OpenTelemetry". v2 will:

- Add an OpenTelemetry exporter so a v1 dashboard can co-exist with an OTel pipeline.
- Not reimplement the W3C trace context, span attributes, or sampling logic. OTel owns those.
- Ship adapters that bridge OTel spans into v1's per-request view, so you get the best of both: a live dev view, plus a full distributed trace for production debugging.

### Queue tracing

When a request is enqueued for background work (BullMQ, Celery, Sidekiq-style), the v1 view stops at the queue push. v2 adds:

- A `@XrayTrace()` decorator that propagates the trace context across the queue.
- A BullMQ adapter (only BullMQ; the other queues are out of scope).
- A `replay` mode that reconstructs the full async tree across the queue boundary.

### Recording and replay (v1 ships the basic version, v2 extends it)

- Capture mode: write a session to disk.
- Replay mode: open the session in the dashboard, scrub through it.
- Share mode: a session can be exported as a tarball and opened by a teammate.

## Out of scope — indefinitely

These are not on the roadmap. We will not build them. If you need them, use a different tool.

- **An APM product.** We are not building a SaaS. We are not building a paid tier. The package is MIT and stays MIT.
- **Browser-side tracing.** `node-xray` is for Node.js servers. For the browser, use the platform's Performance tab.
- **Database query plan capture.** That is the database's job. We capture the _fact_ of a query (kind, label, duration, status) and a redacted version of the query string. The plan is the database's.
- **Network packet capture.** The packet is a lower-level concept than `node-xray` cares about. If you need this, use Wireshark.
- **Production-grade observability.** Use Datadog, New Relic, Honeycomb, Grafana, or OpenTelemetry + a backend of your choice. They are good at this. We are not trying to compete with them. We are the dev tool you reach for before the APM.

## Decision log

The reasons for these decisions, in case the context helps:

- **Why no React in the dashboard?** The v4.1 design is achievable with plain HTML, CSS, and a small JS file. Adding React adds a build step, ~40 KB of code, and a class of bugs we do not want to debug. The single dependency we accept in the dashboard is `ws`.
- **Why no distributed tracing in v1?** Because OpenTelemetry exists. The v1 effort is better spent making the dev experience excellent than reinventing distributed tracing. The v2 bridge is the right way to compose.
- **Why no recording in v1?** Because the wire protocol is small but the storage format is not. Getting the storage format right needs real users. We will ship the basic version in v1.1 and the rich version in v2.
- **Why refuse to mount in prod without auth?** Because the package is dev-only by intent. A "warning" mode trains users to ignore warnings. A "throws at startup" mode fails fast. We chose the latter.

## How to influence the roadmap

- File an issue with a clear use case. "I need X because Y" is more useful than "add X".
- Upvote existing issues. The most-upvoted issue is the most likely to land next.
- Send a PR. v1.1 is open for contributions; the maintainers will review within a week.
- For larger changes, open a discussion first.
