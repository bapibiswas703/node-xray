/**
 * @node-xray/fastify
 *
 * Fastify plugin adapter. Implementation lands in P3.
 * The P0 stub is a no-op so the build chain is testable.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { XRayOptions } from '@node-xray/core';

export type XRayFastifyPlugin = FastifyPluginAsync<{ options?: XRayOptions }>;

/**
 * Fastify plugin. P0 stub: registers nothing. P3 implementation will
 * hook `onRequest`, `preHandler`, `onSend`, `onResponse`, and mount
 * the dashboard route plus the WebSocket upgrade handler.
 */
export const xrayPlugin: XRayFastifyPlugin = async function xrayPlugin(_instance, _opts) {
  // P0: no-op
};
