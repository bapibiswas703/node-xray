# @node-xray/example-nestjs-basic

A minimal NestJS application instrumented with `@node-xray/nestjs`.
Demonstrates `NodeXrayModule.register` (synchronous) with a single
controller and the global interceptor wired automatically.

## Run

```bash
pnpm install
pnpm dev          # tsx watch (auto-reload)
# or
pnpm start
```

Then open:

- **Dashboard** — http://127.0.0.1:3002/_xray/
- **API** — http://127.0.0.1:3002/

## Try it

```bash
curl http://127.0.0.1:3002/
curl http://127.0.0.1:3002/users/42
curl -X POST http://127.0.0.1:3002/login \
  -H 'content-type: application/json' \
  -d '{"username":"alice","password":"hunter2"}'

curl http://127.0.0.1:3002/boom
```

## Production mode

```bash
NODE_ENV=production XRAY_DASHBOARD_PASS=s3cret pnpm start
```

In production the dashboard requires HTTP Basic auth (`admin` /
`XRAY_DASHBOARD_PASS`) and body capture is disabled by default.

## Files

- `src/main.ts` — bootstrap, listen, graceful shutdown.
- `src/app.module.ts` — registers `NodeXrayModule`.
- `src/app.controller.ts` — four routes (root, user, login, boom).

## What it demonstrates

- `NodeXrayModule.register({ path, bufferSize, auth })` — synchronous
  registration. The Core is created at register time.
- The interceptor is auto-bound as `APP_INTERCEPTOR` so every request
  is captured without any further wiring.
- The `XRayService` is injected into a controller and can be used to
  tag request scope (`this.xray.tag(...)`).
- The `auth` option gates both the WebSocket upgrade and the dashboard
  HTTP endpoint.
- The error path: `HttpException(..., 500)` becomes a 500 response, and
  the inspector shows the stack and the `__xrayError` field on the
  record.
