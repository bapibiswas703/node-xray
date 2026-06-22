# Quick start

60-second setup for each supported framework. Each example is the smallest app that makes the dashboard show live data.

> All examples install only the adapter you need. `@node-xray/core` is a transitive dependency.

## Prerequisites

- Node.js **>= 20.18**
- One of: Express `^4.19 || ^5`, Fastify `^4 || ^5`, NestJS `^10`

## Express — JavaScript

```bash
mkdir xray-express && cd xray-express
npm init -y
npm install express
npm install --save-dev @node-xray/express
```

`server.js`

```js
const express = require('express');
const { xray } = require('@node-xray/express');

const app = express();
app.use(express.json());
app.use(xray());

app.get('/api/users', async (_req, res) => {
  // Simulate a DB call so the dashboard has something interesting to show
  await new Promise((r) => setTimeout(r, 35));
  res.json({ ok: true, users: [{ id: 1, name: 'Ada' }] });
});

app.listen(3000, () => console.log('open http://localhost:3000/node-xray'));
```

```bash
node server.js
```

## Express — TypeScript

```bash
mkdir xray-express-ts && cd xray-express-ts
npm init -y
npm install express
npm install --save-dev typescript tsx @types/node @types/express @node-xray/express
npx tsc --init
```

`tsconfig.json` (minimal)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`src/server.ts`

```ts
import express from 'express';
import { xray } from '@node-xray/express';

const app = express();
app.use(express.json());
app.use(xray());

app.get('/api/users', async (_req, res) => {
  await new Promise((r) => setTimeout(r, 35));
  res.json({ ok: true, users: [{ id: 1, name: 'Ada' }] });
});

app.listen(3000, () => console.log('open http://localhost:3000/node-xray'));
```

```bash
npx tsx src/server.ts
```

## Fastify — JavaScript

```bash
mkdir xray-fastify && cd xray-fastify
npm init -y
npm install fastify
npm install --save-dev @node-xray/fastify
```

`server.js`

```js
const Fastify = require('fastify');
const { xrayPlugin } = require('@node-xray/fastify');

const app = Fastify();
app.register(xrayPlugin());

app.get('/api/users', async () => {
  await new Promise((r) => setTimeout(r, 35));
  return { ok: true, users: [{ id: 1, name: 'Ada' }] };
});

app.listen({ port: 3000 }).then(() => console.log('open http://localhost:3000/node-xray'));
```

## Fastify — TypeScript

```bash
mkdir xray-fastify-ts && cd xray-fastify-ts
npm init -y
npm install fastify
npm install --save-dev typescript tsx @types/node @node-xray/fastify
npx tsc --init
```

`src/server.ts`

```ts
import Fastify from 'fastify';
import { xrayPlugin } from '@node-xray/fastify';

const app = Fastify();
await app.register(xrayPlugin());

app.get('/api/users', async () => {
  await new Promise((r) => setTimeout(r, 35));
  return { ok: true, users: [{ id: 1, name: 'Ada' }] };
});

await app.listen({ port: 3000 });
console.log('open http://localhost:3000/node-xray');
```

```bash
npx tsx src/server.ts
```

> Fastify's `onSend` hook is the easiest place to capture the response payload. `xrayPlugin` does not double-buffer; it reads the payload that Fastify has already serialized. See [`FRAMEWORKS.md`](./FRAMEWORKS.md#fastify).

## NestJS — TypeScript only

```bash
mkdir xray-nestjs && cd xray-nestjs
npm init -y
npm install @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs
npm install --save-dev typescript tsx @types/node @node-xray/nestjs
npx tsc --init
```

`tsconfig.json` (minimal)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`src/main.ts`

```ts
import 'reflect-metadata';
import { Module, Controller, Get } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NodeXrayModule } from '@node-xray/nestjs';

@Controller('api')
class ApiController {
  @Get('users')
  async users() {
    await new Promise((r) => setTimeout(r, 35));
    return { ok: true, users: [{ id: 1, name: 'Ada' }] };
  }
}

@Module({
  imports: [NodeXrayModule.register()],
  controllers: [ApiController],
})
class AppModule {}

const app = await NestFactory.create(AppModule);
await app.listen(3000);
console.log('open http://localhost:3000/node-xray');
```

```bash
npx tsx src/main.ts
```

> NestJS works under both `@nestjs/platform-express` and `@nestjs/platform-fastify`. The module detects the platform at boot. See [`FRAMEWORKS.md`](./FRAMEWORKS.md#nestjs).

## What you should see

1. Open <http://localhost:3000/node-xray> in your browser.
2. The topbar shows the live dot, the host, and counters.
3. Hit `http://localhost:3000/api/users` a few times. Each request appears in the left sidebar with its method, path, status, and duration.
4. Click a request to see:
   - **Runtime tab**: call stack, libuv chips, event-loop ring, queues, async waterfall, request timeline, async operations
   - **Request / Response tab**: the JSON body you sent and the JSON body you received
5. Use the control bar to pause the stream, clear, simulate a request, and sort.

## Next steps

- Read [`CONFIGURATION.md`](./CONFIGURATION.md) to tune options.
- Read [`SECURITY.md`](./SECURITY.md) before running this anywhere that is not your laptop.
- Read [`FRAMEWORKS.md`](./FRAMEWORKS.md) for framework-specific gotchas.
- Try one of the runnable examples under [`examples/`](../examples) — each is ~50 lines, type-safe, and boots with `pnpm dev`.
