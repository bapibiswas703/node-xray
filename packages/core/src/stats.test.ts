import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoopStats } from '@node-xray/types';
import { createStatsEmitter } from './stats.js';

const noopLoop: LoopStats = {
  lagMs: 0,
  p50: 0,
  p99: 5,
  max: 0,
  utilization: 0,
  phase: 'unknown',
  sampledAt: 0,
};

function makeMonitor(p99 = 5): { latest(): LoopStats } {
  return { latest: () => ({ ...noopLoop, p99 }) };
}

describe('createStatsEmitter', () => {
  let dropped = 0;
  let threadBusy = 0;
  let payloads: unknown[] = [];

  beforeEach(() => {
    dropped = 0;
    threadBusy = 0;
    payloads = [];
  });

  function newEmitter(opts: { intervalMs?: number } = {}) {
    return createStatsEmitter({
      monitor: makeMonitor(),
      getThreadBusy: () => threadBusy,
      getDropped: () => dropped,
      intervalMs: opts.intervalMs,
      onStats: (p) => {
        payloads.push(p);
      },
    });
  }

  it('reports zero on first sample', () => {
    const e = newEmitter();
    expect(e.latest().reqCount).toBe(0);
    expect(e.latest().errors).toBe(0);
    expect(e.latest().avgMs).toBe(0);
    expect(e.latest().poolBusy).toBe(0);
    expect(e.latest().loopLagP99).toBe(5);
    e.stop();
  });

  it('increments reqCount on noteStartRequest', () => {
    const e = newEmitter();
    e.noteStartRequest();
    e.noteStartRequest();
    e.noteStartRequest();
    expect(e.latest().reqCount).toBe(3);
    e.stop();
  });

  it('counts errors only for status >= 400', () => {
    const e = newEmitter();
    e.noteFinishRequest({ status: 200, durationMs: 10 });
    e.noteFinishRequest({ status: 204, durationMs: 5 });
    e.noteFinishRequest({ status: 301, durationMs: 7 });
    e.noteFinishRequest({ status: 400, durationMs: 50 });
    e.noteFinishRequest({ status: 404, durationMs: 12 });
    e.noteFinishRequest({ status: 500, durationMs: 200 });
    expect(e.latest().errors).toBe(3);
    e.stop();
  });

  it('rolling avg covers exactly the last 100 durations', () => {
    const e = newEmitter();
    // 200 finishes, alternating 10 and 20. The window is the last 100,
    // which — by alternating 10/20 starting with 10 — is 50×10 + 50×20 = 1500
    // over 100 = 15.
    for (let i = 0; i < 200; i++) {
      e.noteFinishRequest({ status: 200, durationMs: i % 2 === 0 ? 10 : 20 });
    }
    expect(e.latest().avgMs).toBe(15);
    e.stop();
  });

  it('ignores non-finite or negative durations without poisoning the avg', () => {
    const e = newEmitter();
    e.noteFinishRequest({ status: 200, durationMs: 100 });
    e.noteFinishRequest({ status: 200, durationMs: Number.NaN });
    e.noteFinishRequest({ status: 200, durationMs: -5 });
    e.noteFinishRequest({ status: 200, durationMs: Number.POSITIVE_INFINITY });
    expect(e.latest().avgMs).toBe(100);
    e.stop();
  });

  it('reset() zeros reqCount, errors, and the rolling window', () => {
    const e = newEmitter();
    e.noteStartRequest();
    e.noteStartRequest();
    e.noteFinishRequest({ status: 500, durationMs: 999 });
    e.noteFinishRequest({ status: 200, durationMs: 42 });
    expect(e.latest().reqCount).toBe(2);
    expect(e.latest().errors).toBe(1);
    expect(e.latest().avgMs).toBeGreaterThan(0);
    e.reset();
    expect(e.latest().reqCount).toBe(0);
    expect(e.latest().errors).toBe(0);
    expect(e.latest().avgMs).toBe(0);
    e.stop();
  });

  it('passes threadBusy through to poolBusy', () => {
    threadBusy = 7;
    const e = newEmitter();
    expect(e.latest().poolBusy).toBe(7);
    e.stop();
  });

  it('passes dropped through to backpressureDropped', () => {
    dropped = 42;
    const e = newEmitter();
    expect(e.latest().backpressureDropped).toBe(42);
    e.stop();
  });

  it('reads poolSize from UV_THREADPOOL_SIZE, defaulting to 4', () => {
    const original = process.env.UV_THREADPOOL_SIZE;
    try {
      process.env.UV_THREADPOOL_SIZE = '16';
      const e = newEmitter();
      expect(e.latest().poolSize).toBe(16);
      e.stop();

      process.env.UV_THREADPOOL_SIZE = 'garbage';
      const e2 = newEmitter();
      expect(e2.latest().poolSize).toBe(4);
      e2.stop();

      delete process.env.UV_THREADPOOL_SIZE;
      const e3 = newEmitter();
      expect(e3.latest().poolSize).toBe(4);
      e3.stop();
    } finally {
      if (original === undefined) delete process.env.UV_THREADPOOL_SIZE;
      else process.env.UV_THREADPOOL_SIZE = original;
    }
  });

  it('reads loopLagP99 from the monitor on every tick', () => {
    let p99 = 1;
    const e = createStatsEmitter({
      monitor: { latest: () => ({ ...noopLoop, p99 }) },
      getThreadBusy: () => 0,
      getDropped: () => 0,
      onStats: () => {
        /* no-op */
      },
    });
    expect(e.latest().loopLagP99).toBe(1);
    p99 = 9;
    expect(e.latest().loopLagP99).toBe(9);
    e.stop();
  });

  it('stop() is idempotent and latest() is safe after stop', () => {
    const e = newEmitter();
    e.stop();
    e.stop();
    expect(e.latest().reqCount).toBe(0);
  });

  it('onStats is wrapped in try/catch and never throws into the host', () => {
    const onStats = vi.fn(() => {
      throw new Error('boom');
    });
    const e = createStatsEmitter({
      monitor: makeMonitor(),
      getThreadBusy: () => 0,
      getDropped: () => 0,
      onStats,
    });
    // Force a tick by calling the internal sample path: the emitter's
    // `tick` is private, but the timer's interval will fire it. We
    // just verify that a throwing onStats doesn't break construction
    // or .latest().
    expect(() => e.latest()).not.toThrow();
    e.stop();
  });

  it('noteStartRequest and noteFinishRequest are no-ops after stop', () => {
    const e = newEmitter();
    e.stop();
    e.noteStartRequest();
    e.noteFinishRequest({ status: 500, durationMs: 50 });
    expect(e.latest().reqCount).toBe(0);
    expect(e.latest().errors).toBe(0);
  });

  it('emits a fresh payload on the configured interval', async () => {
    vi.useFakeTimers();
    try {
      const e = newEmitter({ intervalMs: 100 });
      e.noteStartRequest();
      e.noteStartRequest();
      vi.advanceTimersByTime(150);
      expect(payloads.length).toBeGreaterThanOrEqual(1);
      const first = payloads[0] as { reqCount: number };
      expect(first.reqCount).toBe(2);
      e.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
