import { WebSocketServer, type WebSocket } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { WireFrame, XRayEventName, XRayEventPayload, RequestRecord } from '@node-xray/types';
import { WIRE_VERSION } from '@node-xray/types';
import { XRayWireError } from './errors.js';
import { on, emit } from './events.js';
import type { RequestStore } from './store.js';

const BUFFER_HIGH_WATER = 1_048_576; // 1 MB

export interface HubOptions {
  path: string;
  maxClients: number;
  store: RequestStore;
  getHelloConfig: () => HelloConfigData;
  getServerInfo: () => HelloServerData;
}

/** Internal payload of the `hello` frame. */
export interface HelloConfigData {
  path: string;
  maxRequests: number;
  captureRequestBody: boolean;
  captureResponseBody: boolean;
}

export interface HelloServerData {
  node: string;
  pid: number;
  uptime: number;
  framework: string;
  version: string;
}

export interface HubHandle {
  /** Attach the WebSocket server to a Node `http.Server`. */
  attach(server: HttpServer): void;
  /** Number of currently-connected dashboard clients. */
  clientCount(): number;
  /** Number of frames dropped due to backpressure since start. */
  droppedCount(): number;
  /** Close every connection. */
  close(): Promise<void>;
}

/**
 * Create the WebSocket hub. Does not bind any socket until `attach()` is
 * called. The hub is the bridge between the internal event bus and
 * dashboard clients.
 */
export function createHub(options: HubOptions): HubHandle {
  let wss: WebSocketServer | null = null;
  let dropped = 0;
  const clients = new Set<WebSocket>();
  const unsubs: Array<() => void> = [];

  function send(socket: WebSocket, frame: WireFrame): boolean {
    if (socket.readyState !== socket.OPEN) return false;
    if (socket.bufferedAmount >= BUFFER_HIGH_WATER) {
      dropped++;
      return false;
    }
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  function broadcast(frame: WireFrame): void {
    if (clients.size === 0) return;
    for (const c of clients) send(c, frame);
  }

  function hub(): HubHandle {
    return {
      attach(server: HttpServer) {
        if (wss) return;
        wss = new WebSocketServer({ noServer: true, path: `${options.path}/ws` });
        server.on('upgrade', (req, socket, head) => {
          if (clients.size >= options.maxClients) {
            socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
            socket.destroy();
            return;
          }
          const url = req.url ?? '';
          if (!url.startsWith(`${options.path}/ws`)) return;
          wss?.handleUpgrade(req, socket, head, (ws) => {
            wss?.emit('connection', ws, req);
          });
        });

        wss.on('connection', (socket: WebSocket, _req: IncomingMessage) => {
          clients.add(socket);
          socket.on('close', () => clients.delete(socket));
          socket.on('error', () => clients.delete(socket));

          // Client-to-server frames. Malformed input is dropped, never
          // thrown — a hostile or stale dashboard tab must not be able
          // to surface errors in the host app.
          socket.on('message', (raw) => {
            let frame: ReturnType<typeof parseClientFrame>;
            try {
              frame = parseClientFrame(String(raw));
            } catch {
              return;
            }
            if (frame.type === 'clear') {
              // Clear the server-side ring buffer, then push the now-
              // empty snapshot to EVERY client so all open tabs (and
              // future reloads) agree the history is gone.
              options.store.clear();
              broadcast({ v: WIRE_VERSION, t: 'snapshot', payload: options.store.list() });
            }
            // 'ping' needs no reply: receiving any frame proves the
            // socket is alive, and ws answers protocol-level pings.
          });

          send(socket, {
            v: WIRE_VERSION,
            t: 'hello',
            payload: {
              config: options.getHelloConfig(),
              server: options.getServerInfo(),
            },
          });
          send(socket, { v: WIRE_VERSION, t: 'snapshot', payload: options.store.list() });
        });

        // Forward every internal event as the corresponding wire frame.
        const events: Array<[XRayEventName, (p: XRayEventPayload[XRayEventName]) => WireFrame]> = [
          [
            'request:new',
            (p) => ({ v: WIRE_VERSION, t: 'request:new', payload: p as RequestRecord }),
          ],
          [
            'request:update',
            (p) => ({
              v: WIRE_VERSION,
              t: 'request:update',
              payload: p as { id: string; patch: Partial<RequestRecord> },
            }),
          ],
          [
            'request:done',
            (p) => ({
              v: WIRE_VERSION,
              t: 'request:done',
              payload: { id: (p as RequestRecord).id, record: p as RequestRecord },
            }),
          ],
          ['loop', (p) => ({ v: WIRE_VERSION, t: 'loop', payload: p as never })],
          [
            'error',
            (p) => ({
              v: WIRE_VERSION,
              t: 'error',
              payload: { message: (p as Error).message, code: 'XRAY_INTERNAL' },
            }),
          ],
        ];
        for (const [name, toFrame] of events) {
          unsubs.push(
            on(name, (payload) => {
              broadcast(toFrame(payload));
            }),
          );
        }
      },
      clientCount: () => clients.size,
      droppedCount: () => dropped,
      async close() {
        for (const off of unsubs) off();
        unsubs.length = 0;
        if (wss) {
          await new Promise<void>((resolve) => wss!.close(() => resolve()));
          wss = null;
        }
        clients.clear();
      },
    };
  }

  return hub();
}

/**
 * Validate an incoming frame from a client. The v1 protocol accepts
 * exactly two client-initiated frames:
 *
 *  - `{ t: 'ping' }`  — heartbeat; no reply needed.
 *  - `{ t: 'clear' }` — empty the server-side ring buffer. The server
 *    answers with a fresh (empty) `snapshot` broadcast to all clients.
 *
 * Throws `XRayWireError` for malformed input.
 */
export function parseClientFrame(raw: string): { type: 'ping' | 'clear' } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new XRayWireError(`invalid JSON: ${raw.slice(0, 64)}`);
  }
  if (typeof value !== 'object' || value === null) {
    throw new XRayWireError('frame must be an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj['t'] === 'ping') return { type: 'ping' };
  if (obj['t'] === 'clear') return { type: 'clear' };
  throw new XRayWireError(`unknown client frame type: ${String(obj['t'])}`);
}

/** Emit a typed error via the bus. Used by callers to surface failures. */
export { emit };
