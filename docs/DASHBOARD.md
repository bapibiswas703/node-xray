# Dashboard

The `node-xray` dashboard is a single-page app embedded in the npm package. It opens a WebSocket to your server and renders everything live. The design is the v4.1 mockup, ported to modular assets.

## Opening the dashboard

The default mount point is `http://localhost:3000/node-xray`. The path is configurable via the `path` option (see [`CONFIGURATION.md`](./CONFIGURATION.md#path)).

The first response is the static `index.html`. The browser then opens `ws://<host><path>/ws`. The server sends a `hello` frame, then a `snapshot` frame containing the last `maxRequests` records.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│  topbar    node-xray | live | host:port | counters | status  │
├──────────────┬───────────────────────────────────────────────┤
│  requests    │  selected-request label                       │
│  ─ all       │  ┌──────────────────────────────────────────┐ │
│  ─ 2xx       │  │ tabs:  Runtime  │  Request / Response   │ │
│  ─ err       │  ├──────────────────────────────────────────┤ │
│  ─ >50ms     │  │ tab content                              │ │
│  [list...]   │  │                                          │ │
│              │  │                                          │ │
│              │  ├──────────────────────────────────────────┤ │
│              │  │ statbar                                  │ │
│              │  ├──────────────────────────────────────────┤ │
│              │  │ ctrlbar                                  │ │
└──────────────┴───────────────────────────────────────────────┘
```

## Tabs

### Runtime

This is the main view. It contains, top to bottom:

1. **Call stack** — a LIFO view of the active call frames for the selected request. Frames are sanitized: `node_modules` entries are folded into a single `…` chip, anonymous frames are labeled `(anon)`. The frame marked `GEC — global scope` is the bottom of the stack.

2. **Node APIs — libuv** — chips for the async APIs known to be in flight for this request: `pg.query`, `http.request`, `crypto.pbkdf2`, `setTimeout`, `setInterval`, `setImmediate`, `dns.lookup`, `fs.readFile`, `zlib.gzip`, `net.connect`, `child_process`, `worker_threads`. Below the chips, a thread-pool visualization: a row of squares, busy ones filled.

3. **Event Loop** — a small ring that spins while the loop is busy, with a label for the current phase (`timers`, `pending`, `idle`, `poll`, `check`, `close`).

4. **Task queue (macrotask) / Microtask queue** — two FIFO lists. The macrotask queue shows scheduled timers and immediates. The microtask queue shows pending promise reactions.

5. **Async waterfall** — a horizontal bar chart of the async operations, ordered by start time. Each bar's left edge is the start, width is the duration. Colors: DB (purple), HTTP (amber), Redis (green), DNS (blue), CPU (red).

6. **Request timeline** — a vertical timeline of high-level events: `request received`, service call, DB offload, DB return, response sent. Each entry has a colored dot, a label, a meta line, and a relative timestamp.

7. **Async operations** — a grid of cards, one per async op: name, status (`done` / `pending` / `error` / `—`), duration, a query / URL preview, a percent bar, a bar fill. Truncated queries end with `…`.

### Request / Response

Two side-by-side panels. Each has a header (with a copy button), metadata tags, a collapsible headers section, and a JSON viewer with syntax highlighting.

- **Request** — method, URL, content type, auth type, body size, parsed JSON, all request headers.
- **Response** — status, time, size, content type, parsed JSON, all response headers.

The body is highlighted with the standard five colors: key (blue), string (green), number (amber), boolean (purple), null (gray). A `__truncated: true` field appears if the body was over `maxBodySize`.

The "copy" button copies the raw JSON to the clipboard and shows a "copied" confirmation for 1 second.

## Sidebar — request list

The left sidebar lists the most recent requests, newest first by default. Each row shows:

- The method (color-coded badge)
- The path (truncated)
- The status (color-coded)
- The duration or `pending…`

### Filters

Four chips at the top of the sidebar:

- **all** — everything in the buffer.
- **2xx** — successful responses only.
- **err** — 4xx and 5xx.
- **>50ms** — slow requests.

Filters are applied client-side, in-memory. They do not affect what the server records.

### Sorting

The control bar has a sort selector with three options:

- **newest** — by start time, descending. Default.
- **slowest** — by duration, descending. Pending requests are at the bottom.
- **errors first** — 5xx, then 4xx, then the rest. Within each group, newest first.

## Control bar

- **pause / live** — toggles the WebSocket subscription. When paused, new requests do not appear and existing rows do not update. The connection stays open; only the rendering stops. Useful when a flood of requests is making the UI janky.
- **clear** — empties the local view (and the server buffer, if you confirm). Confirmation is implicit; the button is destructive.
- **simulate req** — sends a synthetic `GET /__xray/simulate` request to the server. Useful for checking that the dashboard is connected when the app is otherwise idle.
- **sort** — described above.

## Statbar

A bottom strip with six counters:

- **total** — number of requests in the buffer.
- **2xx** — count of successful responses.
- **errors** — count of 4xx and 5xx.
- **avg** — mean duration over the buffer.
- **loop lag** — current event-loop lag, in ms. Green under 10 ms, amber 10–50 ms, red above.
- **thread pool** — `busy/size`. Green when 0–1 busy, amber 2–3, red 4+.

The statbar updates every 500 ms via the `loop` frame.

## Keyboard

| Key       | Action                            |
| --------- | --------------------------------- |
| `j` / `↓` | Select next request               |
| `k` / `↑` | Select previous request           |
| `1`       | Runtime tab                       |
| `2`       | Request / Response tab            |
| `p`       | Toggle pause                      |
| `c`       | Clear (with confirm)              |
| `f`       | Cycle sidebar filter              |
| `?`       | Show this help (planned for v1.1) |

## Connection lifecycle

1. The page loads. A `WebSocket` is opened.
2. The server sends `hello`, then `snapshot` (the last `maxRequests` records).
3. As requests happen, the server pushes `request:new`, `request:update`, `request:done`, and `loop` frames.
4. If the connection drops, the client reconnects with exponential backoff (1s, 2s, 4s, …, cap 30s). On reconnect, it requests a new `snapshot`.

## Limits of the in-process model

The dashboard shows only what your Node process is handling. In a multi-replica deployment, each replica has its own dashboard. There is no aggregation in v1. See [`ROADMAP.md`](./ROADMAP.md) for the multi-replica story.
