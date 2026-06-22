---
'@node-xray/core': minor
'@node-xray/types': minor
'@node-xray/dashboard': minor
'@node-xray/express': minor
'@node-xray/fastify': minor
'@node-xray/nestjs': minor
---

# p6 — hardening

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
