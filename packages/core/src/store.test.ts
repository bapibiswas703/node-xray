import { describe, it, expect } from 'vitest';
import { RequestStore, createPartialRecord, appendTimeline, appendAsyncOp } from './store.js';
import type { RequestRecord } from '@node-xray/types';

function makeRecord(id: string): RequestRecord {
  return createPartialRecord({
    id,
    method: 'GET',
    path: '/api/x',
    framework: 'custom',
    request: { headers: {} },
  });
}

describe('RequestStore', () => {
  it('rejects maxRequests < 1', () => {
    expect(() => new RequestStore({ maxRequests: 0 })).toThrow(RangeError);
  });

  it('adds, lists, and gets records', () => {
    const s = new RequestStore({ maxRequests: 5 });
    const a = makeRecord('a');
    const b = makeRecord('b');
    s.add(a);
    s.add(b);
    expect(s.size).toBe(2);
    expect(s.get('a')).toBe(a);
    expect(s.list()).toEqual([a, b]);
  });

  it('evicts FIFO when over capacity', () => {
    const s = new RequestStore({ maxRequests: 2 });
    s.add(makeRecord('a'));
    s.add(makeRecord('b'));
    s.add(makeRecord('c'));
    expect(s.size).toBe(2);
    expect(s.get('a')).toBeUndefined();
    expect(s.get('b')).toBeDefined();
    expect(s.get('c')).toBeDefined();
  });

  it('updates an existing record', () => {
    const s = new RequestStore({ maxRequests: 5 });
    const a = makeRecord('a');
    s.add(a);
    s.update('a', { status: 200 });
    expect(s.get('a')?.status).toBe(200);
  });

  it('update is a no-op for unknown ids', () => {
    const s = new RequestStore({ maxRequests: 5 });
    s.update('nope', { status: 200 });
    expect(s.size).toBe(0);
  });

  it('finishes a record in place', () => {
    const s = new RequestStore({ maxRequests: 5 });
    const a = makeRecord('a');
    s.add(a);
    const done = { ...a, status: 200, durationMs: 12 };
    s.finish(done);
    expect(s.get('a')?.status).toBe(200);
    expect(s.get('a')?.durationMs).toBe(12);
  });

  it('finishes a sampled-out record by inserting it', () => {
    const s = new RequestStore({ maxRequests: 5 });
    const a = makeRecord('a');
    s.finish(a);
    expect(s.get('a')).toBe(a);
  });

  it('clears the buffer', () => {
    const s = new RequestStore({ maxRequests: 5 });
    s.add(makeRecord('a'));
    s.add(makeRecord('b'));
    s.clear();
    expect(s.size).toBe(0);
  });

  it('subscribes and broadcasts on changes', () => {
    const s = new RequestStore({ maxRequests: 5 });
    const calls: number[] = [];
    const off = s.subscribe(() => calls.push(s.size));
    expect(calls).toEqual([0]); // initial snapshot
    s.add(makeRecord('a'));
    s.add(makeRecord('b'));
    s.update('a', { status: 200 });
    s.clear();
    off();
    s.add(makeRecord('c'));
    expect(calls).toEqual([0, 1, 2, 2, 0]);
  });
});

describe('createPartialRecord', () => {
  it('initializes a partial record', () => {
    const r = createPartialRecord({
      id: 'r1',
      method: 'POST',
      path: '/api/x',
      framework: 'express',
      request: { headers: { foo: 'bar' } },
    });
    expect(r).toMatchObject({
      id: 'r1',
      method: 'POST',
      path: '/api/x',
      status: 0,
      durationMs: null,
      framework: 'express',
      timeline: [],
      asyncOps: [],
      request: { headers: { foo: 'bar' } },
      response: { headers: {} },
      tags: {},
    });
  });
});

describe('appendTimeline', () => {
  it('appends a timeline entry', () => {
    const r = makeRecord('a');
    const next = appendTimeline(r, { at: 0, kind: 'sync', name: 'handler' });
    expect(next.timeline).toEqual([{ at: 0, kind: 'sync', name: 'handler' }]);
    expect(r.timeline).toEqual([]);
  });

  it('caps the timeline at 500 entries', () => {
    let r = makeRecord('a');
    for (let i = 0; i < 600; i++) {
      r = appendTimeline(r, { at: i, kind: 'sync', name: 'x' });
    }
    expect(r.timeline.length).toBe(500);
  });
});

describe('appendAsyncOp', () => {
  it('appends an async op', () => {
    const r = makeRecord('a');
    const next = appendAsyncOp(r, {
      id: 'op1',
      kind: 'db',
      label: 'pg.query',
      startedAt: 0,
      durationMs: null,
      status: 'pending',
    });
    expect(next.asyncOps.length).toBe(1);
  });

  it('caps the asyncOps at 200 entries', () => {
    let r = makeRecord('a');
    for (let i = 0; i < 250; i++) {
      r = appendAsyncOp(r, {
        id: `op${i}`,
        kind: 'db',
        label: 'x',
        startedAt: 0,
        durationMs: null,
        status: 'pending',
      });
    }
    expect(r.asyncOps.length).toBe(200);
  });
});
