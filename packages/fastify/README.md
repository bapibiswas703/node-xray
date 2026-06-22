# @node-xray/fastify

Fastify plugin adapter for `node-xray`.

> Implementation lands in P3. The P0 stub is a no-op so the build chain is testable.

```ts
import Fastify from 'fastify';
import { xrayPlugin } from '@node-xray/fastify';

const app = Fastify();
await app.register(xrayPlugin());
```
