import { describe, it, expect, afterEach } from 'vitest';
import { startLoopMonitor, eventLoopUtilization, currentEventLoopPhase } from './loop.js';

afterEach(() => {
  // No public stop helper on the monitor; reach into the singleton by
  // emitting a no-op loop sample via the singleton.
  // In practice tests should not start the monitor more than once.
});

describe('loop helpers', () => {
  it('eventLoopUtilization returns a number in [0, 1]', () => {
    const u = eventLoopUtilization();
    expect(typeof u).toBe('number');
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThanOrEqual(1);
  });

  it('currentEventLoopPhase returns a known label', () => {
    const phase = currentEventLoopPhase();
    expect(['timers', 'pending', 'idle', 'poll', 'check', 'close', 'unknown']).toContain(phase);
  });

  it('startLoopMonitor returns a handle with latest()', async () => {
    const h = startLoopMonitor();
    const stats = h.latest();
    expect(stats).toMatchObject({
      lagMs: expect.any(Number),
      p50: expect.any(Number),
      p99: expect.any(Number),
      max: expect.any(Number),
      utilization: expect.any(Number),
      phase: expect.any(String),
      sampledAt: expect.any(Number),
    });
    h.stop();
  });
});
