---
'@node-xray/nestjs': minor
---

Add the `@node-xray/nestjs` adapter.

The package ships `NodeXrayModule` with both `register()` (synchronous) and
`registerAsync()` (factory-based) entry points, a `XRayService` that wraps the
underlying `Core`, and a global `XrayInterceptor` (registered via
`APP_INTERCEPTOR`) that captures every HTTP request.

Highlights:

- Auto-mounts the dashboard and the WebSocket hub on the first request
  on both `@nestjs/platform-express` and `@nestjs/platform-fastify`.
- Honors the standard `XRayOptions` plus the NestJS-specific
  `intercept` flag for opting out of automatic capture.
- Lowercases the HTTP method, derives the route from either
  Express's `request.route.path` or Nest's class+handler metadata,
  and supports an `ignore` predicate, `enabled: false` no-op mode,
  and the production `auth` guard.
- Defers request finalization via `setTimeout` so NestJS's exception
  filter has time to set the correct status code on 4xx/5xx paths.
- Ships with 14 integration tests covering both platforms, the
  factory registration path, and the `XRayService` surface.
