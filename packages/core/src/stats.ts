import type { StatsPayload, LoopStats } from '@node-xray/types';

const DEFAULT_INTERVAL_MS = 500;
const ROLLING_WINDOW = 100;

function readPoolSize(): number {
  const raw = process.env.UV_THREADPOOL_SIZE;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

export interface StatsEmitterOptions {
  /** Read the latest event-loop stats. Called every tick. */
  readonly monitor: { latest(): LoopStats };
  /** Read the current advisory thread-pool busy count. */
  readonly getThreadBusy: () => number;
  /** Read the cumulative backpressure-dropped frame count. */
  readonly getDropped: () => number;
  /** How often to sample and invoke `onStats`. Default 500. */
  readonly intervalMs?: number;
  /** Receive every fresh aggregate. Must not throw. */
  readonly onStats: (payload: StatsPayload) => void;
}

export interface StatsEmitter {
  /** Record a request start. Cheap. */
  noteStartRequest(): void;
  /** Record a request finish. `durationMs` is the final record value. */
  noteFinishRequest(input: { readonly status: number; readonly durationMs: number }): void;
  /** Zero the cumulative counters and the rolling duration window. */
  reset(): void;
  /** Read the most recent aggregate without waiting for the next tick. */
  latest(): StatsPayload;
  /** Stop the timer. Idempotent. `latest()` is still safe to call. */
  stop(): void;
}

/**
 * Aggregate the in-flight telemetry into a `StatsPayload` and broadcast it
 * on a fixed cadence. The emitter owns:
 *
 *   - `reqCount`  — cumulative since start, or since the last `reset()`
 *   - `errors`    — cumulative `status >= 400` over the same window
 *   - `avgMs`     — mean `durationMs` over the most recent 100 finished
 *                   records (small rolling window; a cumulative mean would
 *                   drift toward the slowest outlier)
 *   - `loopLagP99`— `monitor.latest().p99`
 *   - `poolBusy`  — passed through from the advisory `threadMark` counter
 *   - `poolSize`  — `process.env.UV_THREADPOOL_SIZE` (or 4 on read failure)
 *   - `backpressureDropped` — passed through from the WS hub
 *
 * `latest()` is a fresh sample on every call (not a cache of the last
 * broadcast), so callers — including the test suite and `CoreInternals.
 * snapshotStats()` — see the current state synchronously.
 *
 * Failure-isolated: `onStats` is wrapped in try/catch and errors are
 * swallowed silently. The emitter never throws into the host app.
 */
export function createStatsEmitter(options: StatsEmitterOptions): StatsEmitter {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const poolSize = readPoolSize();
  let totalRequests = 0;
  let totalErrors = 0;
  const durations: number[] = [];
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  function sample(): StatsPayload {
    const loop = options.monitor.latest();
    const avg =
      durations.length === 0 ? 0 : durations.reduce((s, d) => s + d, 0) / durations.length;
    return {
      reqCount: totalRequests,
      errors: totalErrors,
      avgMs: avg,
      loopLagP99: loop.p99,
      poolBusy: options.getThreadBusy(),
      poolSize,
      backpressureDropped: options.getDropped(),
    };
  }

  function tick(): void {
    if (stopped) return;
    try {
      options.onStats(sample());
    } catch {
      // The emitter must never break the host app. The onStats
      // contract says "must not throw", but we belt-and-suspender it.
    }
  }

  timer = setInterval(tick, intervalMs);
  // Never keep the process alive just for the stats emitter.
  timer.unref();

  return {
    noteStartRequest() {
      if (stopped) return;
      totalRequests++;
    },
    noteFinishRequest({ status, durationMs }) {
      if (stopped) return;
      if (status >= 400) totalErrors++;
      if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
        if (durations.length >= ROLLING_WINDOW) durations.shift();
        durations.push(durationMs);
      }
    },
    reset() {
      totalRequests = 0;
      totalErrors = 0;
      durations.length = 0;
    },
    latest() {
      return sample();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
