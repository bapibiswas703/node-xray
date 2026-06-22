/**
 * @node-xray/express
 *
 * Express middleware adapter. Implementation lands in P2.
 * The P0 stub exposes the function shape so the build chain is testable.
 */

import type { RequestHandler } from 'express';
import type { XRayOptions } from '@node-xray/core';

/**
 * Create the `xray()` middleware. P0 stub: returns a pass-through.
 * P2 implementation will mount the dashboard route, the WebSocket
 * upgrade handler, and wrap `res` for body capture.
 */
export function xray(_options?: XRayOptions): RequestHandler {
  return function xrayMiddleware(_req, _res, next) {
    next();
  };
}
