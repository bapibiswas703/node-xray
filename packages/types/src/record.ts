/**
 * Per-request telemetry record. The full record is sent over the wire
 * to the dashboard and to custom sinks.
 */
export interface RequestRecord {
  id: string;
  method: string;
  path: string;
  route?: string;
  status: number;
  startedAt: number;
  durationMs: number | null;
  error?: SerializedError;
  timeline: TimelineEntry[];
  asyncOps: AsyncOp[];
  stack?: string[];
  request: SnapshotSide;
  response: SnapshotSide;
  thread?: { busy: number; size: number };
  loop?: { lagMs: number; phase: EventLoopPhase };
  framework: 'express' | 'fastify' | 'nestjs' | 'custom';
  tags: Record<string, string | number | boolean>;
}

export interface SnapshotSide {
  headers: Record<string, string>;
  body?: unknown;
}

export interface TimelineEntry {
  /** Milliseconds since the request started. */
  at: number;
  kind: TimelineKind;
  name: string;
  detail?: string;
  durationMs?: number;
}

export type TimelineKind = 'sync' | 'await' | 'timer' | 'io' | 'db' | 'http' | 'render' | 'send';

export interface AsyncOp {
  id: string;
  kind: AsyncOpKind;
  label: string;
  startedAt: number;
  durationMs: number | null;
  detail?: string;
  status: 'pending' | 'done' | 'error';
  error?: string;
}

export type AsyncOpKind = 'db' | 'http' | 'fs' | 'crypto' | 'dns' | 'other';

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

/**
 * Phase of the Node.js event loop. Best-effort; `'unknown'` is a valid
 * value when the phase cannot be inferred.
 */
export type EventLoopPhase = 'timers' | 'pending' | 'idle' | 'poll' | 'check' | 'close' | 'unknown';
