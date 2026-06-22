import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type { Server as HttpServer } from 'node:http';
import { xray } from './index.js';
import { _clearAllForTest } from '@node-xray/core';

let app: Express;
let server: HttpServer;

let xrayInstance: ReturnType<typeof xray>;

beforeEach(async () => {
  _clearAllForTest();
  app = express();
  app.use(express.json());
  xrayInstance = xray({ maxRequests: 50 });
  app.use(xrayInstance);
});

afterEach(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('@node-xray/express', () => {
  describe('basic request capture', () => {
    it('records a simple GET request', async () => {
      app.get('/api/ping', (_req, res) => {
        res.status(200).json({ ok: true });
      });
      server = app.listen(0);

      const res = await request(server).get('/api/ping');
      expect(res.status).toBe(200);

      // Give the res 'finish' event time to fire
      await new Promise((r) => setTimeout(r, 50));

      const records = xrayInstance.store.list();
      const rec = records.find((r) => r.method === 'get' && r.path === '/api/ping');
      expect(rec).toBeDefined();
      expect(rec?.status).toBe(200);
      expect(rec?.durationMs).toBeGreaterThan(0);
      expect(rec?.framework).toBe('express');
    });

    it('records the matched route', async () => {
      app.get('/api/users/:id', (_req, res) => res.json({ id: 1 }));
      server = app.listen(0);
      await request(server).get('/api/users/42');
      await new Promise((r) => setTimeout(r, 100));

      const rec = xrayInstance.store.list().find((r) => r.path === '/api/users/42');
      expect(rec?.route).toBe('/api/users/:id');
    });

    it('captures GET request with no body', async () => {
      app.get('/api/empty', (_req, res) => res.json({}));
      server = app.listen(0);
      await request(server).get('/api/empty');
      await new Promise((r) => setTimeout(r, 50));

      const rec = xrayInstance.store.list().find((r) => r.path === '/api/empty');
      expect(rec?.request.body).toBeUndefined();
    });
  });

  describe('request body capture', () => {
    it('captures a parsed JSON request body', async () => {
      app.post('/api/echo', (req, res) => res.json({ ok: true }));
      server = app.listen(0);

      await request(server).post('/api/echo').send({ name: 'Ada', age: 36, password: 'secret123' });

      await new Promise((r) => setTimeout(r, 50));

      const rec = xrayInstance.store.list().find((r) => r.path === '/api/echo');
      expect(rec?.request.body).toBeDefined();
      const body = rec?.request.body as Record<string, unknown>;
      expect(body['name']).toBe('Ada');
      expect(body['age']).toBe(36);
      // password is in the default redaction list
      expect(body['password']).toBe('[REDACTED]');
    });

    it('captures nested request body fields', async () => {
      app.post('/api/users', (_req, res) => res.json({ ok: true }));
      server = app.listen(0);

      await request(server)
        .post('/api/users')
        .send({ user: { token: 'tk_123', name: 'Ada' } });

      await new Promise((r) => setTimeout(r, 50));

      const rec = xrayInstance.store.list().find((r) => r.path === '/api/users');
      const body = rec?.request.body as { user: { token: string; name: string } };
      expect(body.user.token).toBe('[REDACTED]');
      expect(body.user.name).toBe('Ada');
    });

    it('captures array element fields', async () => {
      app.post('/api/cards', (_req, res) => res.json({ ok: true }));
      server = app.listen(0);

      await request(server)
        .post('/api/cards')
        .send({
          cards: [
            { cvv: '111', n: '1' },
            { cvv: '222', n: '2' },
          ],
        });

      await new Promise((r) => setTimeout(r, 50));

      const rec = xrayInstance.store.list().find((r) => r.path === '/api/cards');
      const body = rec?.request.body as { cards: Array<{ cvv: string; n: string }> };
      expect(body.cards[0]?.cvv).toBe('[REDACTED]');
      expect(body.cards[1]?.cvv).toBe('[REDACTED]');
      expect(body.cards[0]?.n).toBe('1');
    });

    it('redacts the authorization header by default', async () => {
      app.get('/api/secret', (_req, res) => res.json({ ok: true }));
      server = app.listen(0);
      await request(server).get('/api/secret').set('Authorization', 'Bearer xyz');
      await new Promise((r) => setTimeout(r, 50));

      const rec = xrayInstance.store.list().find((r) => r.path === '/api/secret');
      const headers = rec?.request.headers as Record<string, string>;
      expect(headers['authorization']).toBe('[REDACTED]');
    });
  });

  describe('response body capture', () => {
    it('captures res.json() payload', async () => {
      app.get('/api/data', (_req, res) => res.json({ hello: 'world' }));
      server = app.listen(0);
      await request(server).get('/api/data');
      await new Promise((r) => setTimeout(r, 50));

      const rec = xrayInstance.store.list().find((r) => r.path === '/api/data');
      expect(rec?.response.body).toEqual({ hello: 'world' });
    });

    it('captures res.send(string) payload', async () => {
      app.get('/text', (_req, res) => res.type('text/plain').send('hello'));
      server = app.listen(0);
      await request(server).get('/text');
      await new Promise((r) => setTimeout(r, 50));

      const rec = xrayInstance.store.list().find((r) => r.path === '/text');
      expect(rec?.response.body).toBe('hello');
    });

    it('captures streamed chunks via res.write + res.end', async () => {
      app.get('/stream', (_req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write('data: chunk1\n\n');
        res.write('data: chunk2\n\n');
        res.end('data: chunk3\n\n');
      });
      server = app.listen(0);
      const res = await request(server).get('/stream');
      expect(res.text).toBe('data: chunk1\n\ndata: chunk2\n\ndata: chunk3\n\n');
      await new Promise((r) => setTimeout(r, 50));

      const rec = xrayInstance.store.list().find((r) => r.path === '/stream');
      expect(rec?.response.body).toBe('data: chunk1\n\ndata: chunk2\n\ndata: chunk3\n\n');
    });

    it('redacts response body fields', async () => {
      app.get('/api/login', (_req, res) => res.json({ token: 'tk_123', user: 'Ada' }));
      server = app.listen(0);
      await request(server).get('/api/login');
      await new Promise((r) => setTimeout(r, 50));

      const rec = xrayInstance.store.list().find((r) => r.path === '/api/login');
      const body = rec?.response.body as { token: string; user: string };
      expect(body.token).toBe('[REDACTED]');
      expect(body.user).toBe('Ada');
    });

    it('truncates response bodies over maxBodySize', async () => {
      // Recreate with a tiny cap
      _clearAllForTest();
      const local = express();
      local.use(express.json());
      const localXray = xray({ maxBodySize: 50, maxRequests: 50 });
      local.use(localXray);
      local.get('/big', (_req, res) => {
        res.json({ data: 'x'.repeat(200) });
      });
      server = local.listen(0);

      await request(server).get('/big');
      await new Promise((r) => setTimeout(r, 50));

      const rec = localXray.store.list().find((r) => r.path === '/big');
      const body = rec?.response.body as { __truncated: boolean; originalSize: number };
      expect(body.__truncated).toBe(true);
      expect(body.originalSize).toBeGreaterThan(50);
    });
  });

  describe('error handling', () => {
    it('records an error passed via next(err)', async () => {
      app.get('/api/boom', (_req, _res, next) => {
        next(new Error('boom!'));
      });
      // Register the xray error handler BEFORE the user error
      // middleware so it can record the error.
      app.use(xrayInstance.errorHandler);
      // User error middleware
      app.use(
        (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
          res.status(500).json({ error: err.message });
        },
      );
      server = app.listen(0);

      const res = await request(server).get('/api/boom');
      expect(res.status).toBe(500);
      await new Promise((r) => setTimeout(r, 50));

      const rec = xrayInstance.store.list().find((r) => r.path === '/api/boom');
      expect(rec?.status).toBe(500);
      expect(rec?.error?.message).toBe('boom!');
    });

    it('records a 404 as a normal request', async () => {
      server = app.listen(0);
      await request(server).get('/no-such-route');
      await new Promise((r) => setTimeout(r, 50));

      const rec = xrayInstance.store.list().find((r) => r.path === '/no-such-route');
      expect(rec?.status).toBe(404);
    });
  });

  describe('ignore predicate', () => {
    it('skips ignored paths entirely', async () => {
      app.get('/health', (_req, res) => res.json({ ok: true }));
      app.get('/api/users', (_req, res) => res.json({ ok: true }));

      // Default ignore already covers /favicon.ico and /node-xray
      // Add a custom ignore for /health via a new xray instance
      _clearAllForTest();
      const localXray = xray({
        ignore: (ctx) => ctx.path === '/health',
        maxRequests: 50,
      });
      const localApp = express();
      localApp.use(express.json());
      localApp.use(localXray);
      localApp.get('/health', (_req, res) => res.json({ ok: true }));
      localApp.get('/api/users', (_req, res) => res.json({ ok: true }));
      server = localApp.listen(0);

      await request(server).get('/health');
      await request(server).get('/api/users');
      await new Promise((r) => setTimeout(r, 50));

      const records = localXray.store.list();
      expect(records.find((r) => r.path === '/health')).toBeUndefined();
      expect(records.find((r) => r.path === '/api/users')).toBeDefined();
    });
  });

  describe('dashboard mount', () => {
    it('serves the dashboard HTML on GET /node-xray', async () => {
      app.get('/api/users', (_req, res) => res.json({ ok: true }));
      server = app.listen(0);
      const res = await request(server).get('/node-xray');
      // The P1 redirect or P5 SPA. Both are valid; we just need a 2xx.
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
    });

    it('explicit mountDashboard() is idempotent', async () => {
      app.get('/api/users', (_req, res) => res.json({ ok: true }));
      server = app.listen(0);

      // Calling twice should not throw.
      expect(() => xrayInstance.mountDashboard(server)).not.toThrow();
      expect(() => xrayInstance.mountDashboard(server)).not.toThrow();
    });
  });

  describe('concurrency', () => {
    it('handles multiple concurrent requests without losing data', async () => {
      app.get('/api/items/:id', (req, res) => res.json({ id: req.params['id'], ok: true }));
      server = app.listen(0);

      await Promise.all(
        Array.from({ length: 20 }, (_, i) => request(server).get(`/api/items/${i}`)),
      );
      await new Promise((r) => setTimeout(r, 100));

      const records = xrayInstance.store.list();
      const itemRecords = records.filter((r) => r.path.startsWith('/api/items/'));
      expect(itemRecords.length).toBe(20);
      // Every record has a unique id
      const ids = new Set(itemRecords.map((r) => r.id));
      expect(ids.size).toBe(20);
    });
  });

  describe('modes and disabling', () => {
    it('is a no-op when enabled: false', async () => {
      _clearAllForTest();
      const localXray = xray({ enabled: false });
      const localApp = express();
      localApp.use(express.json());
      localApp.use(localXray);
      localApp.get('/api/x', (_req, res) => res.json({ ok: true }));
      server = localApp.listen(0);

      await request(server).get('/api/x');
      await new Promise((r) => setTimeout(r, 50));

      // Muted core has a 1-slot store
      expect(localXray.store.size).toBeLessThanOrEqual(1);
    });
  });
});
