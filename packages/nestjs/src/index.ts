/**
 * @node-xray/nestjs
 *
 * NestJS module adapter. The public surface is exported from
 * `./index.js`. This file holds the NestJS-specific NestJS imports
 * (Module, Injectable, etc.) so that the public barrel is small.
 *
 * The adapter:
 *
 *  1. Creates a `Core` at register time.
 *  2. Registers `XRayService` as a global provider.
 *  3. Registers `XrayInterceptor` as a global `APP_INTERCEPTOR`
 *     so every request is captured automatically.
 *  4. Captures the http.Server lazily on the first request,
 *     working on both `@nestjs/platform-express` and
 *     `@nestjs/platform-fastify`.
 *  5. Honors the `ignore` predicate, the `enabled: false` no-op
 *     mode, and the production `auth` guard from P1.
 *  6. Exposes `@XrayTrace()` for explicit per-method span creation.
 *
 * Throws `XRayConfigError` at register time if the configuration is
 * invalid (e.g. conflicting `path`, missing `auth` in production).
 */
export { NodeXrayModule, XRAY_SERVICE } from './module.js';
export { XRayService, XRAY_CORE } from './service.js';
export { XrayInterceptor } from './interceptor.js';
export { XRayTrace, XRAY_TRACE_KEY } from './decorator.js';
export { XRAY_REQUEST_KEY, XRAY_RESPONSE_KEY } from './symbols.js';
export type { XRayNestjsOptions, XRayRequest, XRayResponse, XRayNestjsHandle } from './types.js';
