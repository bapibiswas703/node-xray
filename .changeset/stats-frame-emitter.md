---
'@node-xray/core': minor
'@node-xray/dashboard': patch
---

Emit the `stats` wire frame every 500 ms with real `reqCount` (cumulative since process start or last `clear`), `errors` (cumulative `status >= 400`), `avgMs` (rolling-100 mean), `loopLagP99` (from the loop monitor), `poolBusy` (the advisory `threadMark` counter), `poolSize` (read once from `process.env.UV_THREADPOOL_SIZE`, default 4), and `backpressureDropped` (from the WS hub). The dashboard's status bar (`total` / `2xx` / `errors` / `avg` / `loop lag` / `thread pool` / `dropped`) now renders server-aggregated data instead of client-side approximations; the `st-drop` tile is live. The `clear` client frame resets the cumulative counters via a new `onClear` hook on the hub. Closes `docs/AUDIT.md` findings 7 and 8 (partial — see also docs/CHECKLIST.md §2 item 2 thread-pool half). No wire-protocol version bump — the `StatsFrame` type already existed and the dashboard's switch falls through unknown `t` values.
