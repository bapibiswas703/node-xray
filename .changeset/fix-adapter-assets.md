---
'@node-xray/express': patch
'@node-xray/fastify': patch
'@node-xray/nestjs': patch
---

# fix — adapters: resolve dashboard assets via createRequire

The express, fastify, and nestjs adapters were calling
`getAssetsDir()` from `@node-xray/dashboard` to locate the
dashboard's `assets/` directory. tsup inlined that function
into the consumer's dist at build time, which broke the
`__filename` / `import.meta.url` resolution inside it. The
function then returned a path relative to the WRONG file, and
the dashboard silently fell back to a "not installed"
placeholder.

**Fix**

Each adapter now resolves the assets directory itself, using
`createRequire(import.meta.url)` to find the dashboard's
main entry at runtime (in the adapter's own context, not the
bundled one). The path is then computed as
`<mainEntry>/../../assets/`, which works in both monorepo
(source) and published (dist / `node_modules`) layouts.

The dashboard's `package.json` is not reachable via
`require.resolve('@node-xray/dashboard/package.json')` because
its `exports` field does not include it; the main entry is the
only thing that is always reachable.

**Additional express fix**

The express middleware serves the dashboard HTML and then
returns early, which meant `tryMountDashboard` never ran and
the core's `request` listener was never added. The static
assets (`app.js`, `styles.css`) returned 404 because the core
listener that serves them was not registered. The middleware
now calls `tryMountDashboard` after writing the dashboard
response, so the listener is in place for subsequent requests.

**Verified**

- `pnpm -r test` → 162/162 (was 162/162).
- `examples/express-basic` now serves the real 10,437-byte
  v4.1 dashboard HTML with all CSP / X-Frame-Options / COOP /
  CORP headers.
- `examples/express-basic` now serves `/_xray/app.js` and
  `/_xray/styles.css` with the correct MIME types.
