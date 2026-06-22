import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { xrayPlugin } from './index.js';
import { _clearAllForTest } from '@node-xray/core';

let app: FastifyInstance;
let xrayInstance: Awaited<ReturnType<typeof xrayPlugin>>;

beforeEach(async () => {
  _clearAllForTest();
  app = Fastify({ logger: false });
  xrayInstance = xrayPlugin({ maxRequests: 50 });
  await app.register(xrayInstance);
});

afterEach(async () => {
  if (app) await app.close();
});

describe('@node-xray/fastify', () => {
  describe('basic request capture', () => {
    it('records a simple GET request', async () => {
      app.get('/api/ping', async () => ({ ok: true }));

      const res = await app.inject({ method: 'GET', url: '/api/ping' });
      expect(res.statusCode).toBe(200);

      // Allow the onResponse hook to fire.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const records = xrayInstance.core.store.list();
      const rec = records.find((r) => r.path === '/api/ping');
      expect(rec).toBeDefined();
      expect(rec?.status).toBe(200);
      expect(rec?.framework).toBe('fastify');
      expect(rec?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('records the matched route', async () => {
      app.get('/api/users/:id', async () => ({ id: 1 }));

      await app.inject({ method: 'GET', url: '/api/users/42' });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const rec = xrayInstance.core.store.list().find((r) => r.path === '/api/users/42');
      expect(rec?.route).toBe('/api/users/:id');
    });

    it('captures a GET request with no body', async () => {
      app.get('/api/empty', async () => ({}));

      await app.inject({ method: 'GET', url: '/api/empty' });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const rec = xrayInstance.core.store.list().find((r) => r.path === '/api/empty');
      expect(rec?.request.body).toBeUndefined();
    });
  });

  describe('request body capture', () => {
    it('captures a parsed JSON request body', async () => {
      app.post('/api/echo', async () => ({ ok: true }));

      await app.inject({
        method: 'POST',
        url: '/api/echo',
        payload: { name: 'Ada', age: 36, password: 'secret123' },
      });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const rec = xrayInstance.core.store.list().find((r) => r.path === '/api/echo');
      expect(rec?.request.body).toBeDefined();
      const body = rec?.request.body as Record<string, unknown>;
      expect(body['name']).toBe('Ada');
      expect(body['age']).toBe(36);
      // password is in the default redaction list
      expect(body['password']).toBe('[REDACTED]');
    });

    it('captures nested request body fields', async () => {
      app.post('/api/users', async () => ({ ok: true }));

      await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: { user: { token: 'tk_123', name: 'Ada' } },
      });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const rec = xrayInstance.core.store.list().find((r) => r.path === '/api/users');
      const body = rec?.request.body as { user: { token: string; name: string } };
      expect(body.user.token).toBe('[REDACTED]');
      expect(body.user.name).toBe('Ada');
    });

    it('redacts the authorization header by default', async () => {
      app.get('/api/secret', async () => ({ ok: true }));

      await app.inject({
        method: 'GET',
        url: '/api/secret',
        headers: { authorization: 'Bearer xyz' },
      });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const rec = xrayInstance.core.store.list().find((r) => r.path === '/api/secret');
      const headers = rec?.request.headers as Record<string, string>;
      expect(headers['authorization']).toBe('[REDACTED]');
    });
  });

  describe('response body capture (via onSend)', () => {
    it('captures a JSON response payload', async () => {
      app.get('/api/data', async () => ({ hello: 'world' }));

      await app.inject({ method: 'GET', url: '/api/data' });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const rec = xrayInstance.core.store.list().find((r) => r.path === '/api/data');
      expect(rec?.response.body).toEqual({ hello: 'world' });
    });

    it('captures a string response', async () => {
      app.get('/text', async (_req, reply) => {
        reply.type('text/plain');
        return 'hello';
      });

      await app.inject({ method: 'GET', url: '/text' });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const rec = xrayInstance.core.store.list().find((r) => r.path === '/text');
      expect(rec?.response.body).toBe('hello');
    });

    it('redacts response body fields', async () => {
      app.get('/api/login', async () => ({ token: 'tk_123', user: 'Ada' }));

      await app.inject({ method: 'GET', url: '/api/login' });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const rec = xrayInstance.core.store.list().find((r) => r.path === '/api/login');
      const body = rec?.response.body as { token: string; user: string };
      expect(body.token).toBe('[REDACTED]');
      expect(body.user).toBe('Ada');
    });

    it('truncates response bodies over maxBodySize', async () => {
      _clearAllForTest();
      const localXray = xrayPlugin({ maxBodySize: 50, maxRequests: 50 });
      const localApp = Fastify({ logger: false });
      await localApp.register(localXray);
      localApp.get('/big', async () => ({ data: 'x'.repeat(200) }));

      await localApp.inject({ method: 'GET', url: '/big' });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const rec = localXray.core.store.list().find((r) => r.path === '/big');
      const body = rec?.response.body as { __truncated: boolean; originalSize: number };
      expect(body.__truncated).toBe(true);
      expect(body.originalSize).toBeGreaterThan(50);
      await localApp.close();
    });
  });

  describe('error handling', () => {
    it('records an error from a thrown handler', async () => {
      app.get('/api/boom', async () => {
        throw new Error('boom!');
      });

      const res = await app.inject({ method: 'GET', url: '/api/boom' });
      expect(res.statusCode).toBe(500);
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const rec = xrayInstance.core.store.list().find((r) => r.path === '/api/boom');
      expect(rec?.status).toBe(500);
      expect(rec?.error?.message).toBe('boom!');
    });

    it('records a 404 as a normal request', async () => {
      await app.inject({ method: 'GET', url: '/no-such-route' });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const rec = xrayInstance.core.store.list().find((r) => r.path === '/no-such-route');
      expect(rec?.status).toBe(404);
    });
  });

  describe('global scope (via fastify-plugin)', () => {
    it('records requests from sibling plugins in the same instance', async () => {
      // The plugin uses `fastify-plugin` to disable encapsulation, so
      // its hooks fire for every request handled by the app.
      const localApp = Fastify({ logger: false });
      const localXray = xrayPlugin({ maxRequests: 50 });
      await localApp.register(localXray);
      localApp.get('/alpha', async () => ({ ok: true }));

      // Register a sibling plugin that has its own routes.
      await localApp.register(async (instance) => {
        instance.get('/beta', async () => ({ ok: true }));
      });

      await localApp.inject({ method: 'GET', url: '/alpha' });
      await localApp.inject({ method: 'GET', url: '/beta' });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const records = localXray.core.store.list();
      expect(records.find((r) => r.path === '/alpha')).toBeDefined();
      expect(records.find((r) => r.path === '/beta')).toBeDefined();
      await localApp.close();
    });
  });

  describe('ignore predicate', () => {
    it('skips ignored paths entirely', async () => {
      _clearAllForTest();
      const localXray = xrayPlugin({
        ignore: (ctx) => ctx.path === '/health',
        maxRequests: 50,
      });
      const localApp = Fastify({ logger: false });
      await localApp.register(localXray);
      localApp.get('/health', async () => ({ ok: true }));
      localApp.get('/api/users', async () => ({ ok: true }));

      await localApp.inject({ method: 'GET', url: '/health' });
      await localApp.inject({ method: 'GET', url: '/api/users' });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      const records = localXray.core.store.list();
      expect(records.find((r) => r.path === '/health')).toBeUndefined();
      expect(records.find((r) => r.path === '/api/users')).toBeDefined();
      await localApp.close();
    });
  });

  describe('dashboard mount', () => {
    it('serves the dashboard HTML on GET /node-xray', async () => {
      const res = await app.inject({ method: 'GET', url: '/node-xray' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
    });
  });

  describe('concurrency', () => {
    it('handles multiple concurrent requests without losing data', async () => {
      app.get('/api/items/:id', async (req) => ({
        id: (req.params as { id: string }).id,
      }));

      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) => app.inject({ method: 'GET', url: `/api/items/${i}` })),
      );
      expect(responses.every((r) => r.statusCode === 200)).toBe(true);

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 50));

      const records = xrayInstance.core.store.list();
      const itemRecords = records.filter((r) => r.path.startsWith('/api/items/'));
      expect(itemRecords.length).toBe(20);
      const ids = new Set(itemRecords.map((r) => r.id));
      expect(ids.size).toBe(20);
    });
  });

  describe('modes and disabling', () => {
    it('is a no-op when enabled: false', async () => {
      _clearAllForTest();
      const localXray = xrayPlugin({ enabled: false });
      const localApp = Fastify({ logger: false });
      await localApp.register(localXray);
      localApp.get('/api/x', async () => ({ ok: true }));

      await localApp.inject({ method: 'GET', url: '/api/x' });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      // Muted core has a 1-slot store
      expect(localXray.core.store.size).toBeLessThanOrEqual(1);
      await localApp.close();
    });
  });
});
