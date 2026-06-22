---
'@node-xray/dashboard': minor
'@node-xray/core': minor
'@node-xray/express': minor
'@node-xray/fastify': minor
'@node-xray/nestjs': minor
---

Replace the inline placeholder dashboard with the real `@node-xray/dashboard`
package. The dashboard ships as three static assets (`index.html`,
`app.js`, `styles.css`) that the adapters discover through the new
`getAssetsDir()` helper and pass to the core via the new
`core.mount(server, { assetsDir })` option.

Highlights:

- **`@node-xray/dashboard`** is now a real package. It contains a
  faithful port of the v4.1 mockup (top bar with live event-loop
  lag, requests sidebar with filters, runtime tab with call stack /
  Node APIs / event loop / macro+micro queues / async waterfall /
  timeline / async grid, body inspector tab with request+response
  panels, aggregate stat bar, pause / clear / sort controls)
  rendered by a vanilla-JS WebSocket client that consumes the
  `@node-xray/types` wire protocol. No framework, no build step.
- **`@node-xray/core`** serves the assets synchronously from memory,
  replacing the inline redirect placeholder. The mount API now
  accepts `{ assetsDir }`; when omitted the route returns a 503
  install hint so dashboards still load gracefully.
- **`@node-xray/express`**, **`@node-xray/fastify`**, and
  **`@node-xray/nestjs`** each declare `@node-xray/dashboard` as a
  runtime dependency and pass `getAssetsDir()` through to the core
  on first request. The inline `DASHBOARD_HTML` placeholders are
  gone; the first request to the dashboard path returns the
  real UI.
- New tests: 9 dashboard asset / wire-protocol sanity tests and 3
  core mount-with-assetsDir tests cover the new surface.
