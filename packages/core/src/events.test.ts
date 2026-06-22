import { describe, it, expect, beforeEach } from 'vitest';
import { on, off, emit, listenerCount, _clearAllForTest } from './events.js';
import type { RequestRecord } from '@node-xray/types';

function makeRecord(id: string): RequestRecord {
  return {
    id,
    method: 'GET',
    path: '/',
    status: 0,
    startedAt: 0,
    durationMs: null,
    timeline: [],
    asyncOps: [],
    request: { headers: {} },
    response: { headers: {} },
    framework: 'custom',
    tags: {},
  };
}

beforeEach(() => {
  _clearAllForTest();
});

describe('event bus', () => {
  it('invokes listeners in registration order', () => {
    const calls: string[] = [];
    on('request:done', () => calls.push('a'));
    on('request:done', () => calls.push('b'));
    on('request:done', () => calls.push('c'));
    emit('request:done', makeRecord('x'));
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('returns an unsubscribe function from on()', () => {
    const calls: number[] = [];
    const off = on('request:done', () => calls.push(1));
    emit('request:done', makeRecord('x'));
    off();
    emit('request:done', makeRecord('x'));
    expect(calls).toEqual([1]);
  });

  it('off() removes a specific listener', () => {
    const calls: string[] = [];
    const l = () => calls.push('x');
    on('request:done', l);
    off('request:done', l);
    emit('request:done', makeRecord('x'));
    expect(calls).toEqual([]);
  });

  it('listenerCount returns the registered count', () => {
    expect(listenerCount('request:done')).toBe(0);
    on('request:done', () => {});
    on('request:done', () => {});
    expect(listenerCount('request:done')).toBe(2);
  });

  it('a throwing listener re-emits an error event but does not break the bus', () => {
    const calls: string[] = [];
    on('request:done', () => {
      throw new Error('boom');
    });
    on('request:done', () => calls.push('after'));
    on('error', (e) => calls.push(`err:${e.message}`));
    emit('request:done', makeRecord('x'));
    expect(calls).toEqual(['err:boom', 'after']);
  });

  it('re-entrant emit is bounded', () => {
    let depth = 0;
    on('loop', () => {
      depth++;
      if (depth < 100)
        emit('loop', {
          lagMs: 0,
          p50: 0,
          p99: 0,
          max: 0,
          utilization: 0,
          phase: 'unknown',
          sampledAt: 0,
        });
    });
    emit('loop', {
      lagMs: 0,
      p50: 0,
      p99: 0,
      max: 0,
      utilization: 0,
      phase: 'unknown',
      sampledAt: 0,
    });
    // Bounded to MAX_EMIT_DEPTH (16), so we never reach 100.
    expect(depth).toBeLessThanOrEqual(20);
  });
});
