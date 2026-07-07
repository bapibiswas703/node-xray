---
'@node-xray/core': minor
'@node-xray/dashboard': patch
---

Dashboard "clear" now clears the server-side ring buffer too — previously it only wiped the browser's copy, so reloading the page brought the whole history back from the snapshot. The client sends a `{ v: 1, t: 'clear' }` frame; the server empties the store and rebroadcasts an empty snapshot to every connected tab (documented in docs/EVENTS.md, covered by new WS contract tests). Malformed or unknown client frames are dropped without affecting the socket.

Dashboard layout polish: the page now fills the full browser viewport (an unsized `html`/`body` chain made the root collapse to its 600px min-height, leaving dead space below), the root's border-radius is removed, and the Runtime panels show muted placeholder hints ("select a request to inspect", "idle") instead of blank canvas when no request is selected.

Fix a long-standing dashboard crash: the reset path emptied `#loop-box`, deleting the Event Loop ring and labels from the DOM, so every `loop` frame (twice a second) threw `TypeError: Cannot set properties of null` in `renderLoop` and the Event Loop panel rendered as an empty rectangle. The loop box is no longer cleared (it is process telemetry, not per-request state) and `renderLoop` is null-safe.

Dashboard assets are now served with `cache-control: no-cache` in the Express and Fastify adapters (previously `max-age=3600`) — an hour-long browser cache kept stale, crashing bundles alive across dashboard updates until a hard refresh.
