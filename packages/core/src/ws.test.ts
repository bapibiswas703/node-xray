import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import WebSocket from 'ws';
import { createHub, parseClientFrame, type HubHandle } from './ws.js';
import { RequestStore, createPartialRecord } from './store.js';
import { XRayWireError } from './errors.js';
import { emit } from './events.js';
import type { WireFrame, StatsPayload } from '@node-xray/types';

describe('parseClientFrame', () => {
  it('accepts ping', () => {
    expect(parseClientFrame('{"v":1,"t":"ping"}')).toEqual({ type: 'ping' });
  });

  it('accepts clear', () => {
    expect(parseClientFrame('{"v":1,"t":"clear"}')).toEqual({ type: 'clear' });
  });

  it('rejects invalid JSON', () => {
    expect(() => parseClientFrame('{nope')).toThrow(XRayWireError);
  });

  it('rejects non-objects', () => {
    expect(() => parseClientFrame('42')).toThrow(XRayWireError);
  });

  it('rejects unknown frame types', () => {
    expect(() => parseClientFrame('{"t":"drop-tables"}')).toThrow(XRayWireError);
  });
});

describe('hub client frames (contract)', () => {
  let server: HttpServer | undefined;
  let hub: HubHandle | undefined;

  afterEach(async () => {
    await hub?.close();
    if (server?.listening) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });

  function boot(store: RequestStore): Promise<number> {
    hub = createHub({
      path: '/node-xray',
      maxClients: 4,
      store,
      getHelloConfig: () => ({
        path: '/node-xray',
        maxRequests: 10,
        captureRequestBody: true,
        captureResponseBody: true,
      }),
      getServerInfo: () => ({
        node: process.version,
        pid: process.pid,
        uptime: 0,
        framework: 'test',
        version: '0.0.0',
      }),
    });
    server = createServer((_req, res) => res.end('ok'));
    hub.attach(server);
    return new Promise((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        resolve((server!.address() as { port: number }).port);
      });
    });
  }

  function record(id: string): ReturnType<typeof createPartialRecord> {
    return createPartialRecord({
      id,
      method: 'get',
      path: `/x/${id}`,
      framework: 'custom',
      request: { headers: {} },
    });
  }

  it('a clear frame empties the store and rebroadcasts an empty snapshot to all clients', async () => {
    const store = new RequestStore({ maxRequests: 10 });
    store.add(record('a'));
    store.add(record('b'));
    const port = await boot(store);

    const framesA: WireFrame[] = [];
    const framesB: WireFrame[] = [];
    const open = (sink: WireFrame[]): Promise<WebSocket> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/node-xray/ws`);
        ws.on('message', (d) => sink.push(JSON.parse(String(d)) as WireFrame));
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
      });

    const a = await open(framesA);
    const b = await open(framesB);

    // Both clients got the primed snapshot (2 records) on connect.
    await new Promise((r) => setTimeout(r, 100));
    const firstSnapshot = framesB.find((f) => f.t === 'snapshot');
    expect(firstSnapshot && (firstSnapshot.payload as unknown[]).length).toBe(2);

    a.send(JSON.stringify({ v: 1, t: 'clear' }));
    await new Promise((r) => setTimeout(r, 150));

    expect(store.size).toBe(0);
    // BOTH clients — including the one that did not send the frame —
    // received the empty snapshot rebroadcast.
    const lastA = framesA.filter((f) => f.t === 'snapshot').pop();
    const lastB = framesB.filter((f) => f.t === 'snapshot').pop();
    expect(lastA && (lastA.payload as unknown[]).length).toBe(0);
    expect(lastB && (lastB.payload as unknown[]).length).toBe(0);

    a.close();
    b.close();
  });

  it('malformed and unknown client frames are dropped without killing the socket', async () => {
    const store = new RequestStore({ maxRequests: 10 });
    store.add(record('keep'));
    const port = await boot(store);

    const frames: WireFrame[] = [];
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(`ws://127.0.0.1:${port}/node-xray/ws`);
      s.on('message', (d) => frames.push(JSON.parse(String(d)) as WireFrame));
      s.on('open', () => resolve(s));
      s.on('error', reject);
    });

    ws.send('{not json');
    ws.send('"a string"');
    ws.send(JSON.stringify({ v: 1, t: 'drop-tables' }));
    await new Promise((r) => setTimeout(r, 150));

    // Socket still open, store untouched, and a valid frame still works.
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(store.size).toBe(1);
    ws.send(JSON.stringify({ v: 1, t: 'clear' }));
    await new Promise((r) => setTimeout(r, 150));
    expect(store.size).toBe(0);

    ws.close();
  });

  it('forwards stats events to every connected client as a `stats` frame', async () => {
    const store = new RequestStore({ maxRequests: 10 });
    const port = await boot(store);

    const framesA: WireFrame[] = [];
    const framesB: WireFrame[] = [];
    const open = (sink: WireFrame[]): Promise<WebSocket> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/node-xray/ws`);
        ws.on('message', (d) => sink.push(JSON.parse(String(d)) as WireFrame));
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
      });
    const a = await open(framesA);
    const b = await open(framesB);
    await new Promise((r) => setTimeout(r, 100));

    const sample: StatsPayload = {
      reqCount: 7,
      errors: 1,
      avgMs: 12,
      loopLagP99: 0.4,
      poolBusy: 0,
      poolSize: 4,
      backpressureDropped: 0,
    };
    emit('stats', sample);
    await new Promise((r) => setTimeout(r, 100));

    const lastA = framesA.filter((f) => f.t === 'stats').pop();
    const lastB = framesB.filter((f) => f.t === 'stats').pop();
    expect(lastA?.payload).toEqual(sample);
    expect(lastB?.payload).toEqual(sample);

    a.close();
    b.close();
  });

  it('invokes onClear after store.clear() so callers can reset side state', async () => {
    const store = new RequestStore({ maxRequests: 10 });
    store.add(record('a'));
    let clearFires = 0;
    await new Promise<void>((resolve) => {
      hub = createHub({
        path: '/node-xray',
        maxClients: 4,
        store,
        onClear: () => {
          clearFires++;
        },
        getHelloConfig: () => ({
          path: '/node-xray',
          maxRequests: 10,
          captureRequestBody: true,
          captureResponseBody: true,
        }),
        getServerInfo: () => ({
          node: process.version,
          pid: process.pid,
          uptime: 0,
          framework: 'test',
          version: '0.0.0',
        }),
      });
      server = createServer((_req, res) => res.end('ok'));
      hub.attach(server);
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (server!.address() as { port: number }).port;

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(`ws://127.0.0.1:${port}/node-xray/ws`);
      s.on('open', () => resolve(s));
      s.on('error', reject);
    });
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ v: 1, t: 'clear' }));
    await new Promise((r) => setTimeout(r, 150));
    expect(clearFires).toBe(1);
    expect(store.size).toBe(0);
    ws.close();
  });
});
