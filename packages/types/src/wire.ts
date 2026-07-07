import type { RequestRecord } from './record.js';
import type { LoopStats } from './loop.js';

/**
 * The wire protocol version. Bumped before any breaking change to
 * `WireFrame`. Both client and server negotiate on this value.
 */
export const WIRE_VERSION = 1 as const;

/**
 * Discriminated union of every frame the server can send on the
 * `/<path>/ws` channel. See `docs/EVENTS.md`.
 */
export type WireFrame =
  | HelloFrame
  | SnapshotFrame
  | RequestNewFrame
  | RequestUpdateFrame
  | RequestDoneFrame
  | StatsFrame
  | LoopFrame
  | ErrorFrame;

export interface HelloFrame {
  v: typeof WIRE_VERSION;
  t: 'hello';
  payload: HelloPayload;
}

export interface SnapshotFrame {
  v: typeof WIRE_VERSION;
  t: 'snapshot';
  payload: readonly RequestRecord[];
}

export interface RequestNewFrame {
  v: typeof WIRE_VERSION;
  t: 'request:new';
  payload: RequestRecord;
}

export interface RequestUpdateFrame {
  v: typeof WIRE_VERSION;
  t: 'request:update';
  payload: { id: string; patch: Partial<RequestRecord> };
}

export interface RequestDoneFrame {
  v: typeof WIRE_VERSION;
  t: 'request:done';
  payload: { id: string; record: RequestRecord };
}

export interface StatsFrame {
  v: typeof WIRE_VERSION;
  t: 'stats';
  payload: StatsPayload;
}

export interface LoopFrame {
  v: typeof WIRE_VERSION;
  t: 'loop';
  payload: LoopStats;
}

export interface ErrorFrame {
  v: typeof WIRE_VERSION;
  t: 'error';
  payload: { message: string; code?: string };
}

export interface HelloPayload {
  config: HelloConfig;
  server: HelloServer;
}

/**
 * A subset of the public options. Sensitive fields (`auth`,
 * `redactHeaders`) are never included.
 */
export interface HelloConfig {
  path: string;
  maxRequests: number;
  captureRequestBody: boolean;
  captureResponseBody: boolean;
}

export interface HelloServer {
  node: string;
  pid: number;
  uptime: number;
  framework: string;
  version: string;
}

export interface StatsPayload {
  reqCount: number;
  errors: number;
  avgMs: number;
  loopLagP99: number;
  poolBusy: number;
  poolSize: number;
  backpressureDropped: number;
}

/**
 * Discriminated union of every event the internal bus can emit. Used
 * by the WS hub and by custom sinks.
 */
export type XRayEventName =
  | 'request:new'
  | 'request:update'
  | 'request:done'
  | 'loop'
  | 'error'
  | 'stats';

export type XRayEventPayload = {
  'request:new': RequestRecord;
  'request:update': { id: string; patch: Partial<RequestRecord> };
  'request:done': RequestRecord;
  loop: LoopStats;
  error: Error;
  stats: StatsPayload;
};
