/**
 * @node-xray/core
 *
 * Public API for the core runtime engine. The named export
 * `createCore` is the factory adapters consume. The rest of the public
 * surface is covered by the other named exports below.
 */

export { createCore } from './core.js';
export type { Core, CoreInternals, StartRequestInput, FinishRequestInput } from './core.js';

export { resolveOptions } from './config.js';
export type { ResolvedOptions } from './config.js';

export {
  getContext,
  getContextOrThrow,
  withTags,
  withContext,
  runWithContext,
  RECORD_TAGS_REF,
} from './context.js';

export { on, off, emit, listenerCount, _clearAllForTest } from './events.js';

export { startLoopMonitor, eventLoopUtilization, currentEventLoopPhase } from './loop.js';

export { captureStack } from './stack.js';
export type { CaptureOptions } from './stack.js';

export { redactHeaders, redactBody, truncateBody, redactSnapshot } from './redact.js';
export type { RedactOptions } from './redact.js';

export { RequestStore, createPartialRecord, appendTimeline, appendAsyncOp } from './store.js';
export type { StoreOptions } from './store.js';

export { createHub, parseClientFrame } from './ws.js';
export type { HubOptions, HubHandle, HelloConfigData, HelloServerData } from './ws.js';

export { mountDashboard, applyDashboardSecurityHeaders, verifyDashboardAuth } from './dashboard.js';
export type { MountOptions, DashboardAuthInput } from './dashboard.js';

export {
  XRayError,
  XRayNoContextError,
  XRayConfigError,
  XRayWireError,
  XRayStoreFullError,
} from './errors.js';

export type {
  XRayOptions,
  XRayContext,
  RequestRecord,
  TimelineEntry,
  TimelineKind,
  AsyncOp,
  AsyncOpKind,
  SerializedError,
  SnapshotSide,
  LoopStats,
  EventLoopPhase,
  WireFrame,
  XRayEventName,
  XRayEventPayload,
} from '@node-xray/types';

export { WIRE_VERSION, VERSION } from '@node-xray/types';
