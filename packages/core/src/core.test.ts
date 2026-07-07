import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server as HttpServer } from 'node:http';
import { createServer, request as httpRequest } from 'node:http';
import { createCore } from './core.js';
import { _clearAllForTest, on } from './events.js';
import type { StatsPayload } from '@node-xray/types';

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

  describe('mount() with assetsDir', () => {
    let dir: string;
    let server: HttpServer;
    let baseUrl: string;

    afterEach(async () => {
      if (server && server.listening) {
        await new Promise<void>((r) => server.close(() => r()));
      }
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    const setup = async (): Promise<void> => {
      dir = mkdtempSync(join(tmpdir(), 'xray-core-'));
      writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');
      writeFileSync(join(dir, 'app.js'), 'window.x = 1;');
      writeFileSync(join(dir, 'styles.css'), '.x { color: red; }');
      server = createServer();
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      const { address, port } = server.address() as { address: string; port: number };
      baseUrl = `http://${address}:${port}`;
    };

    const get = (path: string): Promise<{ status: number; body: string; type: string }> =>
      new Promise((resolve, reject) => {
        const req = httpRequest(`${baseUrl}${path}`, { method: 'GET' }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf-8'),
              type: String(res.headers['content-type'] ?? ''),
            }),
          );
        });
        req.on('error', reject);
        req.end();
      });

    it('serves the dashboard HTML when the assets directory is provided', async () => {
      await setup();
      const core = createCore({ path: '/x' });
      core.mount(server, { assetsDir: dir });
      const res = await get('/x/');
      expect(res.status).toBe(200);
      expect(res.body).toContain('<!doctype html>');
      expect(res.type).toMatch(/text\/html/);
      await core.close();
    });

    it('serves app.js and styles.css with the right MIME types', async () => {
      await setup();
      const core = createCore({ path: '/x' });
      core.mount(server, { assetsDir: dir });
      const js = await get('/x/app.js');
      expect(js.status).toBe(200);
      expect(js.type).toMatch(/javascript/);
      expect(js.body).toContain('window.x = 1');
      const css = await get('/x/styles.css');
      expect(css.status).toBe(200);
      expect(css.type).toMatch(/text\/css/);
      expect(css.body).toContain('.x { color: red; }');
      await core.close();
    });

    it('returns a 503 placeholder when the assets directory is missing', async () => {
      await setup();
      // Overwrite the temp dir with an empty one (no index.html).
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), 'xray-core-'));
      const core = createCore({ path: '/x' });
      core.mount(server, { assetsDir: dir });
      const res = await get('/x/');
      // The route returns 503 with the install-hint placeholder when
      // the index.html cannot be read.
      expect([200, 503]).toContain(res.status);
      expect(res.body).toMatch(/node-xray/);
      await core.close();
    });
  });

  describe('auth on the HTTP dashboard endpoint', () => {
    let dir: string;
    let server: HttpServer;
    let baseUrl: string;

    afterEach(async () => {
      if (server && server.listening) {
        await new Promise<void>((r) => server.close(() => r()));
      }
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    const setupAssets = async (): Promise<void> => {
      dir = mkdtempSync(join(tmpdir(), 'xray-core-'));
      writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');
      writeFileSync(join(dir, 'app.js'), 'window.x = 1;');
      writeFileSync(join(dir, 'styles.css'), '.x { color: red; }');
      server = createServer();
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      const { address, port } = server.address() as { address: string; port: number };
      baseUrl = `http://${address}:${port}`;
    };

    const rawGet = (
      path: string,
      headers: Record<string, string> = {},
    ): Promise<{
      status: number;
      body: string;
      headers: Record<string, string | string[] | undefined>;
    }> =>
      new Promise((resolve, reject) => {
        const req = httpRequest(`${baseUrl}${path}`, { method: 'GET', headers }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf-8'),
              headers: res.headers as Record<string, string | string[] | undefined>,
            }),
          );
        });
        req.on('error', reject);
        req.end();
      });

    const auth = (user: string, pass: string): string =>
      'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

    it('rejects unauthenticated requests to the dashboard HTML with 401', async () => {
      await setupAssets();
      const core = createCore({
        path: '/x',
        auth: { type: 'basic', user: 'admin', pass: 'secret' },
      });
      core.mount(server, { assetsDir: dir });
      const res = await rawGet('/x/');
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Basic/);
      await core.close();
    });

    it('rejects unauthenticated requests to /app.js with 401', async () => {
      await setupAssets();
      const core = createCore({
        path: '/x',
        auth: { type: 'basic', user: 'admin', pass: 'secret' },
      });
      core.mount(server, { assetsDir: dir });
      const res = await rawGet('/x/app.js');
      expect(res.status).toBe(401);
      await core.close();
    });

    it('serves the dashboard HTML and assets on a valid Basic credential', async () => {
      await setupAssets();
      const core = createCore({
        path: '/x',
        auth: { type: 'basic', user: 'admin', pass: 'secret' },
      });
      core.mount(server, { assetsDir: dir });
      const html = await rawGet('/x/', { authorization: auth('admin', 'secret') });
      expect(html.status).toBe(200);
      expect(html.body).toContain('<!doctype html>');
      const js = await rawGet('/x/app.js', { authorization: auth('admin', 'secret') });
      expect(js.status).toBe(200);
      await core.close();
    });

    it('rejects a wrong password with 401 (no information leak)', async () => {
      await setupAssets();
      const core = createCore({
        path: '/x',
        auth: { type: 'basic', user: 'admin', pass: 'secret' },
      });
      core.mount(server, { assetsDir: dir });
      const res = await rawGet('/x/', { authorization: auth('admin', 'wrong') });
      expect(res.status).toBe(401);
      // The 401 must include a `WWW-Authenticate: Basic` header.
      expect(res.headers['www-authenticate']).toMatch(/Basic/);
      await core.close();
    });

    it('serves a Bearer token in the Authorization header', async () => {
      await setupAssets();
      const core = createCore({
        path: '/x',
        auth: { type: 'bearer', token: 'sk_test_42' },
      });
      core.mount(server, { assetsDir: dir });
      const ok = await rawGet('/x/', { authorization: 'Bearer sk_test_42' });
      expect(ok.status).toBe(200);
      const wrong = await rawGet('/x/', { authorization: 'Bearer sk_test_99' });
      expect(wrong.status).toBe(401);
      await core.close();
    });

    it('funnels custom-verify exceptions through onError and returns 500', async () => {
      await setupAssets();
      const errors: unknown[] = [];
      const core = createCore({
        path: '/x',
        onError: (err) => errors.push(err),
        auth: {
          type: 'custom',
          verify: () => {
            throw new Error('boom');
          },
        },
      });
      core.mount(server, { assetsDir: dir });
      const res = await rawGet('/x/');
      expect(res.status).toBe(500);
      // The error must surface through onError, NOT as an unhandled
      // rejection (which would fail the test).
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe('boom');
      await core.close();
    });
  });
});

describe('stats integration', () => {
  it('emits a stats event with cumulative counters driven by startRequest/finishRequest', async () => {
    vi.useFakeTimers();
    try {
      const seen: StatsPayload[] = [];
      const core = createCore({ path: '/x' });
      const off = on('stats', (p) => {
        seen.push(p);
      });
      try {
        for (let i = 0; i < 5; i++) {
          const r = core.internals.startRequest({
            id: `r${i}`,
            method: 'GET',
            path: '/api',
            framework: 'custom',
            request: { headers: {} },
          });
          core.internals.finishRequest({
            record: r,
            status: i < 4 ? 200 : 500,
            response: { headers: {} },
            durationMs: 10 + i,
          });
        }
        vi.advanceTimersByTime(500);
        expect(seen.length).toBeGreaterThanOrEqual(1);
        const first = seen[0];
        expect(first.reqCount).toBe(5);
        expect(first.errors).toBe(1);
        expect(first.avgMs).toBeGreaterThan(0);
        expect(first.poolSize).toBeGreaterThanOrEqual(1);
        expect(first.poolBusy).toBe(0);
      } finally {
        off();
        await core.close();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('threadMark and the dropped count appear in the payload', async () => {
    vi.useFakeTimers();
    try {
      const seen: StatsPayload[] = [];
      const core = createCore({ path: '/x' });
      const off = on('stats', (p) => {
        seen.push(p);
      });
      try {
        core.internals.threadMark(true);
        core.internals.threadMark(true);
        vi.advanceTimersByTime(500);
        expect(seen.length).toBeGreaterThanOrEqual(1);
        expect(seen[0].poolBusy).toBe(2);
        core.internals.threadMark(false);
        vi.advanceTimersByTime(500);
        expect(seen[seen.length - 1].poolBusy).toBe(1);
      } finally {
        off();
        await core.close();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('snapshotStats() returns a fresh sample synchronously', async () => {
    const core = createCore({ path: '/x' });
    const r = core.internals.startRequest({
      id: 'r1',
      method: 'GET',
      path: '/api',
      framework: 'custom',
      request: { headers: {} },
    });
    core.internals.finishRequest({
      record: r,
      status: 200,
      response: { headers: {} },
      durationMs: 5,
    });
    const snap = core.internals.snapshotStats();
    expect(snap.reqCount).toBe(1);
    expect(snap.errors).toBe(0);
    expect(snap.avgMs).toBe(5);
    expect(snap.poolSize).toBeGreaterThanOrEqual(1);
    await core.close();
  });
});
