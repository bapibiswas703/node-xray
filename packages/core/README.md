# @node-xray/core

Core runtime engine for `node-xray`. Provides the async context, the in-memory ring buffer, the event-loop monitor, the versioned WebSocket hub, and the default-deny redactor.

> Implementation lands in P1. The P0 stub exports `version()` and `XRayOptions` so the monorepo can compile.

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) and [`docs/API.md`](../../docs/API.md).
