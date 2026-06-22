# @node-xray/example-express-basic

A minimal Express server instrumented with `@node-xray/express`. Use it to
explore the inspector in 60 seconds.

## Run

```bash
pnpm install
cp .env.example .env   # then edit .env if you want a different port/pass
pnpm dev               # auto-reload on save
# or
pnpm start             # plain start
```

The `dev` and `start` scripts use Node's built-in `--env-file=.env` to
load `PORT`, `NODE_ENV`, and `XRAY_DASHBOARD_PASS` from the project
root. Edit `.env` (or export the variables in your shell) to change
them.

Then open:

- **Dashboard** — http://127.0.0.1:3000/_xray/
- **API** — http://127.0.0.1:3000/

## Try it

```bash
# A few normal requests
curl http://127.0.0.1:3000/
curl http://127.0.0.1:3000/users/42
curl -X POST http://127.0.0.1:3000/login \
  -H 'content-type: application/json' \
  -d '{"username":"alice","password":"hunter2"}'

# An error — the inspector will show the stack, the route, the status
curl http://127.0.0.1:3000/boom
```

Open the dashboard and you should see each request, its event-loop block
(if any), its async operations, and the request/response bodies (with
sensitive fields redacted by default).

## Production mode

Edit `.env` and set:

```dotenv
NODE_ENV=production
XRAY_DASHBOARD_PASS=s3cret
```

Then `pnpm start`. The dashboard now requires HTTP Basic auth
(`admin` / `XRAY_DASHBOARD_PASS`), body capture is disabled by default,
and the CSP is tightened to `script-src 'self'`.

## Files

- `src/server.ts` — the entire example. 80 lines, one middleware, four
  routes.

## What it demonstrates

- `xray(core, dashboardOptions)` mounted as Express middleware.
- `core.close()` called in a graceful-shutdown handler.
- Dashboard auth gate (dev = none, prod = Basic).
- Default redaction (the `password` field is masked automatically).
- The error path: a thrown error becomes a 500, and the inspector shows
  the stack and the `__xrayError` field on the record.
