import { describe, it, expect, afterEach } from 'vitest';
import { createCore } from './core.js';
import { _clearAllForTest } from './events.js';

afterEach(() => {
  _clearAllForTest();
});

describe('createCore', () => {
  it('returns a muted core when enabled is false', async () => {
    const core = createCore({ enabled: false });
    expect(core.options.enabled).toBe(false);
    await core.close();
  });

  it('resolves options and exposes a store', () => {
    const core = createCore({ maxRequests: 50, path: '/x' });
    expect(core.options.maxRequests).toBe(50);
    expect(core.options.path).toBe('/x');
    expect(core.store.size).toBe(0);
  });

  it('records a full request lifecycle', () => {
    const core = createCore({ captureRequestBody: true, captureResponseBody: true });
    const partial = core.internals.startRequest({
      id: 'req_1',
      method: 'GET',
      path: '/api/users',
      framework: 'custom',
      request: {
        headers: { authorization: 'Bearer t', accept: 'application/json' },
        body: { password: 'p', name: 'n' },
      },
    });
    expect(partial.status).toBe(0);
    expect(partial.request.headers['authorization']).toBe('[REDACTED]');
    expect(partial.request.headers['accept']).toBe('application/json');
    expect((partial.request.body as { password: string }).password).toBe('[REDACTED]');
    expect(core.store.size).toBe(1);

    const withTimeline = core.internals.addTimeline(partial, {
      at: 1,
      kind: 'sync',
      name: 'service.findOne',
    });
    const final = core.internals.finishRequest({
      record: withTimeline,
      status: 200,
      response: { headers: { 'x-request-id': 'r1' }, body: { ok: true } },
      durationMs: 12,
    });
    expect(final.status).toBe(200);
    expect(final.durationMs).toBe(12);
    expect(final.timeline.length).toBe(1);
    expect(final.response.body).toEqual({ ok: true });
  });

  it('respects the ignore predicate', () => {
    const core = createCore({
      ignore: (ctx) => ctx.path === '/health',
    });
    expect(() =>
      core.internals.startRequest({
        id: 'h',
        method: 'GET',
        path: '/health',
        framework: 'custom',
        request: { headers: {} },
      }),
    ).toThrow(/ignored/);
  });

  it('throws in production without auth', () => {
    const prev = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      expect(() => createCore({ enabled: true })).toThrow(/auth is required/);
    } finally {
      if (prev === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = prev;
    }
  });
});
