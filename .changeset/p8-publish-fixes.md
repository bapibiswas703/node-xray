---
'@node-xray/express': patch
'@node-xray/types': patch
'@node-xray/dashboard': patch
'@node-xray/core': patch
'@node-xray/fastify': patch
'@node-xray/nestjs': patch
---

# p8.1 — fix express static asset race, real version ranges, real publish

The first publish (0.2.0 / 0.3.0) had two blockers that only
surfaced when the package was actually installed and run from npm.

**Static asset race in express**

The express middleware served the dashboard HTML but not
app.js / styles.css. The core's `'request'` listener (added by
`core.mount()`) tried to serve them via an async
`authorize().then()` callback that fires AFTER Express's
synchronous 404 handler, throwing `ERR_HTTP_HEADERS_SENT`.

The middleware now matches `/_xray/app.js`, `/_xray/styles.css`,
and `/_xray/assets/*` and serves them directly, then neutralizes
`res` so the core's later listener is a no-op.

**Workspace protocol in package.json**

`workspace:*` is a pnpm-only protocol. npm rejects it with
`EUNSUPPORTEDPROTOCOL`. All `@node-xray/*` dependencies now use
real semver ranges (`^0.x.y`).

**Published versions (with --access public, no provenance from CLI):**

- @node-xray/types@0.2.1
- @node-xray/dashboard@0.2.1
- @node-xray/core@0.3.1
- @node-xray/express@0.2.2 (then republished as the fix)
- @node-xray/fastify@0.2.1
- @node-xray/nestjs@0.2.1

**Verified end-to-end in a fresh project**

```bash
mkdir test-xray && cd test-xray
npm init -y
npm install @node-xray/express@0.2.2 express
node server.js
curl http://127.0.0.1:3000/_xray/        # 10,437 bytes real HTML
curl http://127.0.0.1:3000/_xray/app.js  # 29 KB
curl http://127.0.0.1:3000/_xray/styles.css  # 16 KB
```

**Tests:** 163/163 (was 162, +1 for the new asset regression
test). Full gate: format, lint, typecheck, test all green.
