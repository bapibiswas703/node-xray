# Framework notes

How `@node-xray/*` integrates with Express, Fastify, and NestJS, and the gotchas to be aware of in each.

## Express

### Basic setup

```ts
import express from 'express';
import { xray } from '@node-xray/express';

const app = express();
app.use(express.json());
app.use(xray()); // register xray AFTER body parsers
app.use(yourRoutes);
```

The middleware must be registered **after** body parsers if you want `captureRequestBody` to capture the parsed object. If you register it before, the adapter falls back to capturing the raw stream up to `maxBodySize`.

### Request body capture

The adapter reads `req.body` after the body parser has populated it. It does a `structuredClone` so the captured value is independent of any mutation your handler does afterwards. For non-JSON payloads (raw text, octet-stream), the adapter buffers the raw request stream up to `maxBodySize` and stores it as a UTF-8 string.

If your handler does not consume the body (e.g. it streams the request to a downstream service), `req.body` is not populated and the adapter will see an empty body. This is correct behavior, not a bug.

### Response body capture

The adapter intercepts three methods:

- `res.json(payload)` — clones `payload`, runs the redactor, stores it.
- `res.send(payload)` — same, with type coercion rules matching Express.
- `res.write(chunk)` and `res.end(chunk)` — for streamed responses. The chunks are concatenated, redacted, and stored.

The interception is at the method level: it overrides the prototype methods on the response object for this request only. Express's own interception (`res.json` calls `res.send`) is preserved.

**Gotcha:** if you replace `res.json` yourself before `xray()` runs, the adapter will use your version. This is intentional: the adapter wraps your wrapper.

**Gotcha:** for very large streaming responses, the concatenation can cost memory. The `maxBodySize` cap applies here too; streams larger than the cap are truncated.

### Streaming and SSE

Server-sent events and chunked responses are supported. The adapter collects chunks as they are written. If `Content-Type` is `text/event-stream`, the stored body is the full event stream with SSE framing preserved.

### `next('route')` and error middleware

When a handler calls `next('route')`, the adapter still records the original request as done with the matched route's status. Errors propagated to an Express error middleware are recorded as `error: { message, stack, name }` and the recorded status is the one set by the error middleware (default 500).

### `trust proxy`

If your app is behind a reverse proxy and `app.set('trust proxy', ...)` is set, the adapter uses `req.ip` accordingly. The captured headers are the original headers as received by Express, not the rewritten ones.

## Fastify

### Basic setup

```ts
import Fastify from 'fastify';
import { xrayPlugin } from '@node-xray/fastify';

const app = Fastify({ logger: true });
await app.register(xrayPlugin());
```

The plugin is encapsulated by default. If you want to scope it to a subset of routes, use Fastify's standard opt-in:

```ts
app.register(async (instance) => {
  instance.register(xrayPlugin());
  instance.get('/debugged', handler);
});
```

### Hooks used

- `onRequest` — create context, snapshot request headers.
- `preHandler` — snapshot request body.
- `onSend` — capture response body (Fastify hands us the serialized payload).
- `onResponse` — finalize the record, broadcast to the WS hub.

`onSend` is the only place we read the response, and Fastify only calls it once per response. There is no double-buffering.

### JSON Schema serialization

When you register a response schema with `schema: { response: { 200: { ... } } }`, Fastify serializes through `fast-json-stringify`. The adapter reads the _output_ of that serialization, not the raw object, so the captured body matches exactly what went on the wire.

If you mutate the payload in a `preSerialization` hook, the captured body reflects the mutation.

### Encapsulation

The plugin creates a child context. If you nest `app.register(xrayPlugin())` inside another encapsulated scope, you get a per-scope store — useful for tests, awkward for production. Use the default top-level registration in production.

### Decorators

`xrayPlugin` decorates the Fastify instance with `app.xray`, a thin proxy over the core API:

```ts
app.get('/api/users', async (req) => {
  const ctx = app.xray.getContext();
  app.xray.tag('user.fetched', true);
  return db.users.findOne(req.params.id);
});
```

## NestJS

### Basic setup

```ts
import { Module } from '@nestjs/common';
import { NodeXrayModule } from '@node-xray/nestjs';

@Module({ imports: [NodeXrayModule.register()] })
class AppModule {}
```

`NodeXrayModule` is a global dynamic module. The interceptor it registers runs for every HTTP route in the application.

### Platform detection

The module works under both `@nestjs/platform-express` and `@nestjs/platform-fastify`. It detects the platform by inspecting `app.getHttpAdapter().getType()`. The detected platform is recorded on every request as `ctx.framework`.

If you use a custom HTTP adapter, the module falls back to `framework: 'custom'` and the request lifecycle hooks are wired manually. See [`API.md`](./API.md#mountdashboardapp-opts).

### `XRayService`

Inject it anywhere:

```ts
import { Injectable } from '@nestjs/common';
import { XRayService } from '@node-xray/nestjs';

@Injectable()
export class UsersService {
  constructor(private readonly xray: XRayService) {}

  async findOne(id: string) {
    return this.xray.withTags({ 'user.id': id }, () => this.repo.findOne({ where: { id } }));
  }
}
```

### `@XrayTrace()` decorator

Marks a controller method or a service method for explicit tracing. The decorator wraps the method in a child span:

```ts
import { XrayTrace } from '@node-xray/nestjs';

@XrayTrace('orders.create')
@Post()
async create(@Body() dto: CreateOrderDto) { ... }
```

The label appears in the timeline of the parent request.

### Guards and interceptors order

The xray interceptor is registered with `APP_INTERCEPTOR`, so it runs after any user-registered guards but before the handler. This is what you want: the interceptor establishes the async context, the handler runs inside it, the interceptor finalizes on the way out.

If you register a global interceptor yourself, it runs _around_ xray, not instead of it. The two compose normally.

### Microservices

The module does not currently support `@nestjs/microservices` (Kafka, gRPC, Redis, NATS). It is HTTP-only in v1. See [`ROADMAP.md`](./ROADMAP.md).

## Cross-cutting

### CORS

The dashboard is served from the same origin as the app. There is no CORS preflight. If you put a CORS middleware in front of the app, make sure the dashboard path is reachable. The `path` you set in `xray()` is not a CORS-allowlisted origin — it is part of the same app.

### Reverse proxies

If you run behind nginx or a load balancer, the WebSocket upgrade must be proxied. The headers that need to be passed through:

- `Upgrade: websocket`
- `Connection: Upgrade`
- `Sec-WebSocket-Key`, `Sec-WebSocket-Version`, `Sec-WebSocket-Protocol`

For nginx, the standard snippet is:

```nginx
location /node-xray/ {
  proxy_pass http://localhost:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 86400s;
}
```

### Container images

The dashboard is served from inside the Node process. There is no extra port. If you run multiple replicas, each replica has its own dashboard — you will only see the requests handled by that replica. This is by design. See [`ROADMAP.md`](./ROADMAP.md) for the multi-replica story.

## Runnable examples

Every framework has a minimal runnable example under [`examples/`](../examples):

- [`examples/express-basic`](../examples/express-basic) — `xray()` + error handler
- [`examples/fastify-basic`](../examples/fastify-basic) — `xrayPlugin` with `fastify-plugin`
- [`examples/nestjs-basic`](../examples/nestjs-basic) — `NodeXrayModule.register` + global interceptor

Each is ~50 lines of TypeScript, runs with `pnpm dev`, and demonstrates the
full path from `app.use(...)` to a working dashboard. See
[`examples/README.md`](../examples/README.md) for the full tour.
