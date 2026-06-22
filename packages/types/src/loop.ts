import type { EventLoopPhase } from './record.js';

export type { EventLoopPhase };

/**
 * A snapshot of the event-loop statistics. Sampled every 500 ms by the
 * core monitor. The `lagMs` field is the current per-tick lag; the
 * `p50`/`p99`/`max` fields are over a 1-second rolling window.
 */
export interface LoopStats {
  /** Current per-tick lag in milliseconds. */
  lagMs: number;
  /** 1-second rolling p50 in milliseconds. */
  p50: number;
  /** 1-second rolling p99 in milliseconds. */
  p99: number;
  /** 1-second rolling max in milliseconds. */
  max: number;
  /** `performance.eventLoopUtilization()`, 0..1. */
  utilization: number;
  /** Best-effort phase label. */
  phase: EventLoopPhase;
  /** `Date.now()` at sample time. */
  sampledAt: number;
}
