---
'@node-xray/core': minor
'@node-xray/express': minor
'@node-xray/fastify': minor
'@node-xray/nestjs': minor
'@node-xray/dashboard': patch
---

Fix five critical defects found in an internal implementation audit:

- **Packaging**: tsup no longer inlines `@node-xray/core` into adapter dists (pnpm workspace symlinks defeated `skipNodeModulesBundle`, shipping a private copy of core and an undeclared `require('ws')` that crashed the published fastify/nestjs packages under pnpm). Workspace packages and `ws` are now externalized; `rxjs` is a declared NestJS peer dependency; packaging regression tests parse each dist and verify every bare require is declared.
- **AsyncLocalStorage context**: all three adapters now wrap downstream execution in the request context — `getContext()` works inside handlers (across `await` and timers), and `withTags()` tags persist onto the finished `RequestRecord` via the new `RECORD_TAGS_REF` accumulator.
- **Custom `path`**: the dashboard client derives its WebSocket endpoint from `location.pathname` instead of a hardcoded `/node-xray`, so custom mount paths (e.g. the examples' `/_xray`) get live data.
- **Auth**: the dashboard HTML and static assets served by the Express middleware, Fastify routes, and NestJS listener are now gated by the configured `auth` (401 + `WWW-Authenticate` for basic). Core gains `verifyDashboardAuth()` and a `serveHttp: false` mount option so exactly one writer owns each dashboard response.
- **`enabled: false`**: Express and Fastify adapters are true no-ops when disabled — no more per-request `onError` spam from the muted core.
