/**
 * @node-xray/types
 *
 * Public type contracts shared by all `node-xray` packages. This package
 * has zero runtime dependencies; it is the single source of truth for
 * the public API surface.
 *
 * Implementation lives in `@node-xray/core` (and the framework adapters).
 * The classes exported here are also implemented in `@node-xray/core`;
 * the `types` package ships only the type-side definitions.
 */

export type { XRayOptions, XRayAuth, XRayAuthRequest } from './options.js';
export type { XRayContext } from './context.js';
export type {
  RequestRecord,
  SnapshotSide,
  TimelineEntry,
  TimelineKind,
  AsyncOp,
  AsyncOpKind,
  SerializedError,
} from './record.js';
export type { EventLoopPhase, LoopStats } from './loop.js';
export type {
  WireFrame,
  HelloFrame,
  SnapshotFrame,
  RequestNewFrame,
  RequestUpdateFrame,
  RequestDoneFrame,
  StatsFrame,
  LoopFrame,
  ErrorFrame,
  HelloPayload,
  HelloConfig,
  HelloServer,
  StatsPayload,
  XRayEventName,
  XRayEventPayload,
} from './wire.js';
export { WIRE_VERSION } from './wire.js';
export {
  XRayError,
  XRayNoContextError,
  XRayConfigError,
  XRayWireError,
  XRayStoreFullError,
} from './errors.js';

export const VERSION = '0.2.0' as const;
