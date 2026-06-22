<div align="center">

# node-xray

**A live runtime inspector for Node.js backends. See call stacks, the event loop, async operations, and request/response bodies — in your browser, in real time.**

[![npm](https://img.shields.io/npm/v/@node-xray/core)](https://www.npmjs.com/org/node-xray)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.18-brightgreen.svg)](https://nodejs.org)
[![ci](https://github.com/bapibiswas703/node-xray/actions/workflows/ci.yml/badge.svg)](https://github.com/bapibiswas703/node-xray/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/npm-provenance-success)](https://docs.npmjs.com/generating-provenance-statements)

</div>

---

## What it is

`node-xray` is a development-only runtime inspector for Node.js HTTP servers. It attaches to your Express, Fastify, or NestJS app with one line of code, opens a dashboard at `/node-xray`, and streams every request through a WebSocket as it happens.

You can see, for each in-flight and completed request:

- The full call stack (LIFO, sanitized)
- The active event-loop phase (`poll`, `timers`, `check`, …)
- Microtask and macrotask queues
- The active libuv / Node APIs and thread-pool utilization
- An async-waterfall timeline
- A request timeline (received → service → DB → response)
- The request and response bodies (with redaction)
- A live status bar: total / 2xx / errors / avg latency / loop lag / pool

It is **not** a profiler, an APM, or a distributed tracer. It is a local debug dashboard that runs in your dev server.

## Why it exists

Local debugging of async Node.js code is painful:

- `console.log` loses the call site, the request, and the surrounding async chain.
- The Node Inspector shows stacks but not per-request async trees.
- APM tools (Datadog, New Relic, OpenTelemetry) are designed for production. You cannot just `npm i` them and get a useful dev view.

`node-xray` fills that gap. It uses `AsyncLocalStorage` to correlate everything that happens inside one HTTP request — DB calls, timers, sub-fetches — and renders it live.

## Install

Pick the adapter for your framework. `@node-xray/core` is a transitive dependency of every adapter and does not need to be installed directly.

```bash
# Express
npm install --save-dev @node-xray/express

# Fastify
npm install --save-dev @node-xray/fastify

# NestJS
npm install --save-dev @node-xray/nestjs
```

Peer requirements: Node.js `>=20.18`, Express `^4.19 || ^5`, Fastify `^4 || ^5`, NestJS `^10`.

## Quick start

### Express (JavaScript)

```js
// server.js
const express = require('express');
const { xray } = require('@node-xray/express');

const app = express();
app.use(express.json());
app.use(xray()); // <- one line

app.get('/api/users', (req, res) => res.json({ ok: true }));

app.listen(3000, () => console.log('http://localhost:3000/node-xray'));
```

### Express (TypeScript)

```ts
import express from 'express';
import { xray } from '@node-xray/express';

const app = express();
app.use(express.json());
app.use(xray());

app.get('/api/users', (_req, res) => res.json({ ok: true }));

app.listen(3000, () => console.log('http://localhost:3000/node-xray'));
```

### Fastify

```ts
import Fastify from 'fastify';
import { xrayPlugin } from '@node-xray/fastify';

const app = Fastify();
await app.register(xrayPlugin());

app.get('/api/users', async () => ({ ok: true }));
await app.listen({ port: 3000 });
```

### NestJS

```ts
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NodeXrayModule } from '@node-xray/nestjs';

@Module({ imports: [NodeXrayModule.register()] })
class AppModule {}

const app = await NestFactory.create(AppModule);
await app.listen(3000);
```

Open <http://localhost:3000/node-xray>. The dashboard is live.

## Examples

Three runnable apps in [`examples/`](./examples), one per framework:

- [`examples/express-basic`](./examples/express-basic) — `xray()` + error handler
- [`examples/fastify-basic`](./examples/fastify-basic) — `xrayPlugin` with `fastify-plugin`
- [`examples/nestjs-basic`](./examples/nestjs-basic) — `NodeXrayModule.register` + global interceptor

Each one is ~50 lines of code, type-safe, and boots in a second with `pnpm dev`. See [`examples/README.md`](./examples/README.md).

## Configuration

Defaults are tuned for development. The full option matrix is in [`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md). The minimum you usually need:

```ts
xray({
  enabled: process.env.NODE_ENV !== 'production', // default
  path: '/node-xray', // default
  captureRequestBody: true, // default in dev
  captureResponseBody: true, // default in dev
  maxBodySize: 100 * 1024, // 100 KB
  maxRequests: 200, // ring buffer size
  ignore: (ctx) => ctx.path === '/health',
  redactHeaders: ['authorization', 'cookie'], // merged with defaults
  redactBodyPaths: ['password', '*.token'],
});
```

In production the package refuses to mount unless you supply an `auth` block. See [`docs/SECURITY.md`](./docs/SECURITY.md).

## Documentation

- [Quick start](./docs/QUICKSTART.md) — 60-second setup for each framework
- [Architecture](./docs/ARCHITECTURE.md) — packages, lifecycle, async-context design
- [Configuration](./docs/CONFIGURATION.md) — every option, defaults, security and perf implications
- [API reference](./docs/API.md) — public API of `@node-xray/core`
- [Framework notes](./docs/FRAMEWORKS.md) — Express, Fastify, NestJS specifics
- [Dashboard](./docs/DASHBOARD.md) — UI tour, filters, keyboard shortcuts
- [Events](./docs/EVENTS.md) — wire protocol and custom sinks
- [Security](./docs/SECURITY.md) — redaction, auth, threat model
- [Performance](./docs/PERFORMANCE.md) — benchmarks and the sampling guide
- [Roadmap](./docs/ROADMAP.md) — what is in and what is intentionally out
- [Contributing](./docs/CONTRIBUTING.md) — dev setup, scripts, release process
- [Changelog](./docs/CHANGELOG.md) — release history

## Packages in this monorepo

| Package                                        | Description                                                |
| ---------------------------------------------- | ---------------------------------------------------------- |
| [`@node-xray/types`](./packages/types)         | Public type contracts                                      |
| [`@node-xray/core`](./packages/core)           | Async context, event store, loop monitor, WS hub, redactor |
| [`@node-xray/express`](./packages/express)     | `xray()` middleware                                        |
| [`@node-xray/fastify`](./packages/fastify)     | `xrayPlugin`                                               |
| [`@node-xray/nestjs`](./packages/nestjs)       | `NodeXrayModule` + `XRayService` + `@XrayTrace()`          |
| [`@node-xray/dashboard`](./packages/dashboard) | UI assets + WebSocket server                               |

## Status

`node-xray` v1.0.0 is the first public release. See the [roadmap](./docs/ROADMAP.md) for the plan toward v2.

## License

[MIT](./LICENSE)
