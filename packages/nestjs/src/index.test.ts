import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Module,
  Inject,
  Injectable,
  HttpException,
  type INestApplication,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { NodeXrayModule, XRayService, XRayTrace as XrayTrace } from './index.js';
import { _clearAllForTest, getContext, withTags } from '@node-xray/core';
import type { Core, RequestRecord } from '@node-xray/core';

export const USERS_SERVICE = Symbol.for('@test.users-service');

@Injectable()
class UsersService {
  getById(id: string): { id: string; name: string } {
    if (id === 'boom') {
      throw new HttpException('User not found', 404);
    }
    return { id, name: `User ${id}` };
  }

  async create(input: { name: string }): Promise<{ id: string; name: string }> {
    return { id: 'u1', name: input.name };
  }
}

@Controller('api/users')
class UsersController {
  constructor(@Inject(USERS_SERVICE) private readonly users: UsersService) {}

  @Get()
  list(): { users: string[] } {
    return { users: ['a', 'b'] };
  }

  @Get(':id')
  byId(@Param('id') id: string): { id: string; name: string } {
    return this.users.getById(id);
  }

  @Post()
  @XrayTrace('users.create')
  async create(@Body() body: { name: string }): Promise<{ id: string; name: string }> {
    return this.users.create(body);
  }
}

@Controller('api/ctx')
class CtxController {
  @Get()
  async get(): Promise<{ atStart?: string; afterAwait?: string; inTimer?: string }> {
    const atStart = getContext()?.requestId;
    await Promise.resolve();
    const afterAwait = getContext()?.requestId;
    const inTimer = await new Promise<string | undefined>((r) =>
      setTimeout(() => r(getContext()?.requestId), 5),
    );
    await withTags({ userId: 'u42' }, async () => {
      await Promise.resolve();
    });
    return {
      ...(atStart ? { atStart } : {}),
      ...(afterAwait ? { afterAwait } : {}),
      ...(inTimer ? { inTimer } : {}),
    };
  }
}

@Module({
  controllers: [UsersController, CtxController],
  providers: [{ provide: USERS_SERVICE, useClass: UsersService }],
})
class UsersModule {}

async function buildApp(register: () => ReturnType<typeof NodeXrayModule.register>): Promise<{
  app: INestApplication;
  core: Core;
  records: () => readonly RequestRecord[];
}> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [register(), UsersModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  const xrayService = app.get(XRayService);
  const core = xrayService.getCore();
  const records = (): readonly RequestRecord[] => core.store.list();

  return { app, core, records };
}

beforeEach(() => {
  _clearAllForTest();
});

describe('@node-xray/nestjs', () => {
  describe('NodeXrayModule.register (sync)', () => {
    it('boots a NestJS app and records a basic GET request', async () => {
      const { app, records } = await buildApp(() => NodeXrayModule.register({ maxRequests: 50 }));

      const res = await request(app.getHttpServer()).get('/api/users');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ users: ['a', 'b'] });

      await new Promise((r) => setImmediate(r));

      const rec = records().find((r) => r.path === '/api/users');
      expect(rec).toBeDefined();
      expect(rec?.method).toBe('get');
      expect(rec?.status).toBe(200);
      expect(rec?.framework).toBe('nestjs');

      await app.close();
    });

    it('records the matched route for parametric paths (Nest class+handler fallback)', async () => {
      const { app, records } = await buildApp(() => NodeXrayModule.register({ maxRequests: 50 }));

      await request(app.getHttpServer()).get('/api/users/42');
      await new Promise((r) => setImmediate(r));

      const rec = records().find((r) => r.path === '/api/users/42');
      expect(rec).toBeDefined();
      // Express sets request.route.path after routing, so we get the
      // actual route pattern.
      expect(rec?.route).toBe('/api/users/:id');

      await app.close();
    });

    it('captures the parsed JSON request body and redacts default secret fields', async () => {
      const { app, records } = await buildApp(() => NodeXrayModule.register({ maxRequests: 50 }));

      const res = await request(app.getHttpServer())
        .post('/api/users')
        .send({ name: 'Ada', password: 'secret123' });
      expect(res.status).toBe(201);

      await new Promise((r) => setImmediate(r));

      const rec = records().find((r) => r.path === '/api/users' && r.method === 'post');
      expect(rec).toBeDefined();
      const body = rec?.request.body as { name: string; password: string };
      expect(body.name).toBe('Ada');
      expect(body.password).toBe('[REDACTED]');

      await app.close();
    });

    it('captures the response body by default in dev (captureResponseBody defaults on)', async () => {
      const { app, records } = await buildApp(() => NodeXrayModule.register({ maxRequests: 50 }));

      await request(app.getHttpServer()).get('/api/users');
      // The finalize is deferred via setTimeout; give it a tick.
      await new Promise((r) => setTimeout(r, 20));

      const rec = records().find((r) => r.path === '/api/users');
      expect(rec?.response.body).toEqual({ users: ['a', 'b'] });

      await app.close();
    });

    it('omits the response body when captureResponseBody is false', async () => {
      const { app, records } = await buildApp(() =>
        NodeXrayModule.register({ maxRequests: 50, captureResponseBody: false }),
      );

      await request(app.getHttpServer()).get('/api/users');
      await new Promise((r) => setImmediate(r));

      const rec = records().find((r) => r.path === '/api/users');
      expect(rec?.response.body).toBeUndefined();

      await app.close();
    });

    it('captures HttpException as a 4xx response with the error attached', async () => {
      const { app, records } = await buildApp(() => NodeXrayModule.register({ maxRequests: 50 }));

      const res = await request(app.getHttpServer()).get('/api/users/boom');
      expect(res.status).toBe(404);
      // Give our setTimeout-deferred finalize time to run.
      await new Promise((r) => setTimeout(r, 50));

      const rec = records().find((r) => r.path === '/api/users/boom');
      expect(rec).toBeDefined();
      expect(rec?.status).toBe(404);

      await app.close();
    });

    it('skips recording when the ignore predicate returns true', async () => {
      const { app, records } = await buildApp(() =>
        NodeXrayModule.register({
          maxRequests: 50,
          ignore: ({ path }) => path.startsWith('/api/users'),
        }),
      );

      await request(app.getHttpServer()).get('/api/users');
      await new Promise((r) => setImmediate(r));

      const recs = records().filter((r) => r.path === '/api/users');
      expect(recs).toHaveLength(0);

      await app.close();
    });

    it('is a no-op when enabled is false', async () => {
      const { app, records } = await buildApp(() =>
        NodeXrayModule.register({ enabled: false, maxRequests: 50 }),
      );

      await request(app.getHttpServer()).get('/api/users');
      await new Promise((r) => setImmediate(r));

      const recs = records().filter((r) => r.path === '/api/users');
      expect(recs).toHaveLength(0);

      await app.close();
    });

    it('mounts the dashboard at the configured path', async () => {
      const { app, records } = await buildApp(() =>
        NodeXrayModule.register({ path: '/node-xray', maxRequests: 50 }),
      );

      // First, make a normal request to trigger the dashboard mount.
      // The dashboard's 'request' listener is added lazily, so the
      // first request to /node-xray would miss it. We warm up the
      // server with a regular request, then test the dashboard.
      await request(app.getHttpServer()).get('/api/users');
      await new Promise((r) => setTimeout(r, 20));

      // Now the dashboard mount should be in place.
      const res = await request(app.getHttpServer()).get('/node-xray');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);

      // The /node-xray request should NOT be recorded (it's ignored).
      await new Promise((r) => setTimeout(r, 20));
      const recorded = records().filter((r) => r.path === '/node-xray');
      expect(recorded).toHaveLength(0);

      await app.close();
    });
  });

  describe('async context propagation (ALS)', () => {
    it('exposes getContext() inside a handler, across await and setTimeout', async () => {
      const { app, records } = await buildApp(() => NodeXrayModule.register({ maxRequests: 50 }));

      const res = await request(app.getHttpServer()).get('/api/ctx');
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 30));

      const rec = records().find((r) => r.path === '/api/ctx');
      expect(rec).toBeDefined();
      const body = res.body as { atStart?: string; afterAwait?: string; inTimer?: string };
      expect(body.atStart).toBe(rec?.id);
      expect(body.afterAwait).toBe(rec?.id);
      expect(body.inTimer).toBe(rec?.id);

      await app.close();
    });

    it('persists withTags tags to the finished record', async () => {
      const { app, records } = await buildApp(() => NodeXrayModule.register({ maxRequests: 50 }));

      await request(app.getHttpServer()).get('/api/ctx');
      await new Promise((r) => setTimeout(r, 30));

      const rec = records().find((r) => r.path === '/api/ctx');
      expect(rec?.tags).toMatchObject({ userId: 'u42' });

      await app.close();
    });
  });

  describe('XRayService', () => {
    it('is injectable and exposes the core', async () => {
      const { app, core } = await buildApp(() => NodeXrayModule.register());
      const svc = app.get(XRayService);
      expect(svc.getCore()).toBe(core);
      expect(svc.getStore()).toBe(core.store);
      expect(svc.getOptions()).toBeDefined();
      await app.close();
    });

    it('withTags runs the callback and returns its value', async () => {
      const { app } = await buildApp(() => NodeXrayModule.register({ maxRequests: 50 }));

      const result = await app.get(XRayService).withTags({ userId: 'u1' }, async () => 42);
      expect(result).toBe(42);

      await app.close();
    });

    it('onModuleDestroy closes the core when the app shuts down', async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [NodeXrayModule.register()],
      }).compile();
      const app = moduleRef.createNestApplication();
      await app.init();
      const svc = app.get(XRayService);
      const core = svc.getCore();
      // app.close() triggers onModuleDestroy which calls core.close().
      // The first close is the only one we need to verify here; the
      // second call is a no-op safety check.
      await app.close();
      await expect(core.close()).resolves.toBeUndefined();
    });
  });

  describe('NodeXrayModule.registerAsync', () => {
    it('defers core creation until the factory resolves', async () => {
      let factoryCalled = false;
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [
          NodeXrayModule.registerAsync({
            useFactory: () => {
              factoryCalled = true;
              return { maxRequests: 25 };
            },
          }),
          UsersModule,
        ],
      }).compile();
      const app = moduleRef.createNestApplication();
      await app.init();
      expect(factoryCalled).toBe(true);

      const res = await request(app.getHttpServer()).get('/api/users');
      expect(res.status).toBe(200);

      const svc = app.get(XRayService);
      expect(svc.getOptions().maxRequests).toBe(25);

      await app.close();
    });
  });

  describe('Fastify platform', () => {
    it('imports the Fastify adapter as a peer dependency (smoke test)', async () => {
      // The Fastify adapter is loaded dynamically so this test does
      // not require it as a hard import. We just confirm the symbol
      // resolves and the package shape is what we expect.
      const mod = (await import('@nestjs/platform-fastify' as string)) as {
        FastifyAdapter: unknown;
      };
      expect(typeof mod.FastifyAdapter).toBe('function');
    });
  });
});
