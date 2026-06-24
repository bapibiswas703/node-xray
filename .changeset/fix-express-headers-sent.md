---
'@node-xray/express': patch
---

# p7.1 — express adapter: fix ERR_HTTP_HEADERS_SENT race

The express adapter's middleware serves the dashboard HTML and then
`core.mount()` adds a `'request'` listener to the same http.Server
that also tries to handle the dashboard path. Both ran; the
middleware ended the response, then the core's listener tried to
call `res.setHeader(...)` and threw `ERR_HTTP_HEADERS_SENT`.

**Fix**

After the middleware sends the dashboard HTML, it now neutralizes
`res.setHeader` and `res.end` on the response so the core's listener
is a no-op when it runs after. This matches the pattern already
used by the NestJS interceptor (`packages/nestjs/src/interceptor.ts`).

**Regression test**

`packages/express/src/index.test.ts` now has a test that drives a
real `http.Server` and asserts both the 200 response and that
`server.on('clientError', ...)` never fires.

**Test count:** 162 (was 161). No other behavior change.
