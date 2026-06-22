# @node-xray/example-fastify-basic

A minimal Fastify server instrumented with `@node-xray/fastify`. Uses
the official `xrayPlugin` (built on `fastify-plugin` so hooks apply
app-wide).

## Run

```bash
pnpm install
pnpm dev          # tsx watch (auto-reload)
# or
pnpm start
```

Then open:

- **Dashboard** — http://127.0.0.1:3001/_xray/
- **API** — http://127.0.0.1:3001/

## Try it

```bash
curl http://127.0.0.1:3001/
curl http://127.0.0.1:3001/users/42
curl -X POST http://127.0.0.1:3001/login \
  -H 'content-type: application/json' \
  -d '{"username":"alice","password":"hunter2"}'

curl http://127.0.0.1:3001/boom
```

## Production mode

```bash
NODE_ENV=production XRAY_DASHBOARD_PASS=s3cret pnpm start
```

In production the dashboard requires HTTP Basic auth (`admin` /
`XRAY_DASHBOARD_PASS`), body capture is disabled by default, and
Fastify's logger is enabled at `info` level.

## Files

- `src/server.ts` — the entire example. ~50 lines, one plugin, four
  routes.

## What it demonstrates

- `xrayPlugin` registered with `app.register` (must be used with
  `fastify-plugin` semantics — already handled by the adapter).
- `dashboard` option passes through the assets directory and (in
  production) auth credentials.
- The plugin installs `onRequest`, `onResponse`, and `onError` hooks
  app-wide.
- The error path: a thrown error in a route becomes a 500, and the
  inspector shows the stack and the `__xrayError` field on the record.
