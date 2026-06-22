/**
 * Soak test: run a long stream of requests through the express
 * adapter and verify no leaks.
 *
 * The test:
 *  1. Boots an Express server with `xray()` enabled.
 *  2. Fires `N` requests across `K` different routes (GET, POST,
 *     with body, with query string, with 404s, with thrown errors).
 *  3. After every batch, snapshots the heap used by the Node process
 *     and the size of the `xray` ring buffer.
 *  4. Asserts the heap does not grow unboundedly and the ring buffer
 *     is bounded by `maxRequests`.
 *
 * Run with `pnpm --filter @node-xray/core test:soak` (not part of
 * the default test suite — explicit opt-in).
 */

import { describe, it, expect } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { xray } from '@node-xray/express';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const BATCHES = 5;
const PER_BATCH = 200;
const MAX_HEAP_GROWTH_MB = 25;

interface Sample {
  batch: number;
  heapUsedMB: number;
  ringSize: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('soak: long-running request stream', () => {
  it('does not leak memory or grow the ring buffer', async () => {
    const app: Express = express();
    app.use(express.json());
    const xrayInstance = xray({ maxRequests: 50 });
    app.use(xrayInstance);
    app.get('/api/ping', (_req, res) => {
      res.json({ ok: true });
    });
    app.post('/api/echo', (req, res) => {
      res.json({ echoed: req.body });
    });
    app.get('/api/slow', async (_req, res) => {
      await sleep(5);
      res.json({ slow: true });
    });
    app.get('/api/error', (_req, _res, next: NextFunction) => {
      next(new Error('boom'));
    });
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    const server: HttpServer = createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const samples: Sample[] = [];

      const fire = async (path: string, init?: RequestInit): Promise<Response> => {
        const res = await fetch(`${baseUrl}${path}`, init);
        // Drain so the response socket is freed.
        await res.text();
        return res;
      };

      for (let batch = 0; batch < BATCHES; batch++) {
        for (let i = 0; i < PER_BATCH; i++) {
          const kind = i % 5;
          if (kind === 0) {
            await fire(`/api/ping?i=${batch}-${i}`);
          } else if (kind === 1) {
            await fire('/api/echo', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ password: 'p', username: 'u' }),
            });
          } else if (kind === 2) {
            await fire('/api/slow');
          } else if (kind === 3) {
            await fire('/api/error');
          } else {
            // Trigger 404 — must not leak through the ignore filter.
            await fire(`/api/missing?i=${batch}-${i}`);
          }
        }

        if (global.gc) global.gc();
        const mem = process.memoryUsage();
        const sample: Sample = {
          batch,
          heapUsedMB: mem.heapUsed / 1024 / 1024,
          ringSize: xrayInstance.store.size,
        };
        samples.push(sample);
      }

      // ── assertions ──
      // 1. The ring buffer is bounded by `maxRequests`. Every sample
      //    after the first should be exactly 50.
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i]?.ringSize).toBe(50);
      }

      // 2. Heap growth between the first and last samples is bounded.
      //    We allow 25 MB of slack to absorb V8 GC noise.
      const first = samples[0]?.heapUsedMB ?? 0;
      const last = samples[samples.length - 1]?.heapUsedMB ?? 0;
      const growth = last - first;
      expect(
        growth,
        `heap grew by ${growth.toFixed(1)} MB across ${BATCHES} batches of ${PER_BATCH} requests`,
      ).toBeLessThan(MAX_HEAP_GROWTH_MB);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 60_000);
});
