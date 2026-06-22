# `node-xray` examples

Minimal, runnable apps for each supported framework. Each one is ~50
lines of code, type-safe, and shows the full path from `app.use(...)`
to a working dashboard.

| Example                            | Framework | Port | What it shows                                       |
| ---------------------------------- | --------- | ---- | --------------------------------------------------- |
| [`express-basic`](./express-basic) | Express 4 | 3000 | `xray()` middleware, error handler, auth gate       |
| [`fastify-basic`](./fastify-basic) | Fastify 5 | 3001 | `xrayPlugin` with `fastify-plugin`, onResponse hook |
| [`nestjs-basic`](./nestjs-basic)   | NestJS 10 | 3002 | `NodeXrayModule.register`, global interceptor       |

## Running

```bash
# Pick one and run
cd express-basic
pnpm install   # links to local workspace packages
pnpm dev       # tsx watch (auto-reload)
# or
pnpm start     # plain tsx
```

Then open the dashboard URL printed to the console.

## Production mode

Every example supports `NODE_ENV=production`. In production:

- The dashboard is gated by HTTP Basic auth (`admin` / `XRAY_DASHBOARD_PASS`).
- Body capture is disabled by default.
- The CSP is tightened to `script-src 'self'`.

```bash
NODE_ENV=production XRAY_DASHBOARD_PASS=s3cret pnpm start
```

## What you should see

After firing a few `curl` requests, the dashboard shows:

- A live list of the most recent requests (default 50 in the example,
  200 in production).
- The matched route, the HTTP method, the response status, the
  duration in ms.
- The captured event-loop block (if the request blocked the loop).
- The captured async operations (timers, microtasks, I/O).
- The captured request and response bodies (with sensitive fields
  redacted by default).
- Any error stack as a `__xrayError` field on the record.

See [`docs/DASHBOARD.md`](../docs/DASHBOARD.md) for a full tour.
