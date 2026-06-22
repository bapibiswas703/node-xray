/**
 * @node-xray/core
 *
 * Core runtime engine: async context, in-memory event store, event-loop
 * monitor, versioned WebSocket hub, and default-deny redactor.
 *
 * Full implementation lands in P1. The P0 stub exposes a placeholder
 * `version()` and a typed `XRayOptions` so downstream adapters can compile.
 */

import type { XRayOptions } from './types.js';

export type { XRayOptions } from './types.js';

/**
 * Returns the package version.
 */
export function version(): string {
  return '0.1.0';
}

/**
 * Placeholder no-op that validates the public option shape is importable.
 * Removed in P1 once the real `createCore(options)` lands.
 */
export function _typecheck(options: XRayOptions): XRayOptions {
  return options;
}
