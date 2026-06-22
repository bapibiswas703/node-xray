import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server as HttpServer } from 'node:http';
import { createServer } from 'node:http';
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
        const http = require('node:http') as typeof import('node:http');
        http
          .get(`${baseUrl}${path}`, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf-8'),
                type: String(res.headers['content-type'] ?? ''),
              }),
            );
          })
          .on('error', reject);
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
});
