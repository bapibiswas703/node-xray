import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { LoopStats, EventLoopPhase } from '@node-xray/types';
import { detectEventLoopPhase } from './config.js';
import { emit } from './events.js';

const SAMPLE_INTERVAL_MS = 500;
const MONITOR_RESOLUTION_MS = 20;

interface MonitorHandle {
  stop(): void;
  latest(): LoopStats;
}

/**
 * Start the event-loop monitor. Returns a handle to stop the monitor
 * and to read the latest sample. The monitor is a singleton per
 * process; calling `startLoopMonitor` twice is a no-op and returns the
 * same handle.
 */
export function startLoopMonitor(): MonitorHandle {
  if (handle) return handle;
  const histogram = monitorEventLoopDelay({ resolution: MONITOR_RESOLUTION_MS });
  histogram.enable();
  let latest: LoopStats = {
    lagMs: 0,
    p50: 0,
    p99: 0,
    max: 0,
    utilization: 0,
    phase: 'unknown',
    sampledAt: Date.now(),
  };
  const timer = setInterval(() => {
    histogram.disable();
    const lagMs = (histogram.min + histogram.max) / 2 / 1e6;
    latest = {
      lagMs,
      p50: histogram.percentile(50) / 1e6,
      p99: histogram.percentile(99) / 1e6,
      max: histogram.max / 1e6,
      utilization: readEventLoopUtilization(),
      phase: detectEventLoopPhase(),
      sampledAt: Date.now(),
    };
    histogram.reset();
    histogram.enable();
    emit('loop', latest);
  }, SAMPLE_INTERVAL_MS);
  // Don't keep the process alive just for the monitor.
  timer.unref();
  handle = {
    stop: () => {
      clearInterval(timer);
      histogram.disable();
      handle = null;
    },
    latest: () => latest,
  };
  return handle;
}

let handle: MonitorHandle | null = null;

let lastUtilization = performance.eventLoopUtilization();

function readEventLoopUtilization(): number {
  const current = performance.eventLoopUtilization();
  const delta = current.utilization - lastUtilization.utilization;
  lastUtilization = current;
  // `delta` is the fraction of wall-clock time spent in event loop
  // callbacks since the last sample. Clamp to [0, 1] for safety.
  return Math.max(0, Math.min(1, delta));
}

/**
 * Read the current event-loop utilization since process start.
 *
 * Equivalent to `performance.eventLoopUtilization()` but cached so
 * adapters can poll without paying the cost on the hot path.
 */
export function eventLoopUtilization(): number {
  return performance.eventLoopUtilization().utilization;
}

/** Read the current best-effort phase. See `detectEventLoopPhase`. */
export function currentEventLoopPhase(): EventLoopPhase {
  return detectEventLoopPhase();
}
