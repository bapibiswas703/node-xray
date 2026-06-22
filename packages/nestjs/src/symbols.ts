/**
 * Internal symbols used by the NestJS adapter to stash per-request
 * state on the raw request/response objects. Defined here as a
 * separate module to avoid circular dependencies.
 */
export const XRAY_REQUEST_KEY = Symbol.for('@node-xray/nestjs.request');
export const XRAY_RESPONSE_KEY = Symbol.for('@node-xray/nestjs.response');
