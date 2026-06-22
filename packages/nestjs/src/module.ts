import {
  Global,
  Module,
  type DynamicModule,
  type Provider,
  type Type,
  type InjectionToken,
} from '@nestjs/common';
import { createCore, type Core } from '@node-xray/core';
import { XRayService, XRAY_CORE } from './service.js';
import { XrayInterceptor } from './interceptor.js';
import type { XRayNestjsOptions } from './types.js';

export const XRAY_SERVICE = Symbol.for('@node-xray/nestjs.XRayService');

/**
 * Register the `node-xray` NestJS module.
 *
 * ```ts
 * @Module({
 *   imports: [NodeXrayModule.register({ path: '/node-xray' })],
 * })
 * class AppModule {}
 * ```
 *
 * The module:
 *
 *  1. Creates a `Core` at register time.
 *  2. Registers `XRayService` as an injectable provider.
 *  3. Registers `XrayInterceptor` as a global `APP_INTERCEPTOR`
 *     so every request is captured automatically.
 *  4. Auto-mounts the dashboard and the WebSocket hub on the
 *     underlying `http.Server` on the first request.
 *  5. Honors the `ignore` predicate, the `enabled: false` no-op
 *     mode, and the production `auth` guard from P1.
 */
@Global()
@Module({})
export class NodeXrayModule {
  /**
   * Synchronous registration. The Core is created at register time
   * with the supplied options. Use this when no other factory needs
   * to run before the Core is created.
   */
  static register(options: XRayNestjsOptions = {}): DynamicModule {
    const core = createCore(options);
    return NodeXrayModule.buildModule(core, options);
  }

  /**
   * Asynchronous registration. Use this when the Core options depend
   * on other providers (e.g. `ConfigService`).
   */
  static registerAsync(opts: {
    useFactory: (...args: unknown[]) => Promise<XRayNestjsOptions> | XRayNestjsOptions;
    inject?: ReadonlyArray<InjectionToken | Type>;
    imports?: ReadonlyArray<DynamicModule | Type>;
  }): DynamicModule {
    const coreProvider: Provider = {
      provide: XRAY_CORE,
      useFactory: async (...args: unknown[]): Promise<Core> => {
        const resolved = await opts.useFactory(...args);
        return createCore(resolved);
      },
      inject: [...(opts.inject ?? [])],
    };

    const serviceProvider: Provider = {
      provide: XRAY_SERVICE,
      useFactory: (core: Core) => new XRayService(core),
      inject: [XRAY_CORE],
    };

    return {
      module: NodeXrayModule,
      global: true,
      imports: [...(opts.imports ?? [])],
      providers: [coreProvider, serviceProvider, XRayService, XrayInterceptor],
      exports: [XRAY_SERVICE, XRayService],
    };
  }

  private static buildModule(core: Core, options: XRayNestjsOptions): DynamicModule {
    void options; // Reserved for future per-option provider selection.

    const coreProvider: Provider = {
      provide: XRAY_CORE,
      useFactory: () => core,
    };

    const serviceProvider: Provider = {
      provide: XRAY_SERVICE,
      useFactory: (c: Core) => new XRayService(c),
      inject: [XRAY_CORE],
    };

    // `APP_INTERCEPTOR` is a multi-provider. `useClass` here lets
    // Nest register it as a multi-binding; the interceptor's `@Inject`
    // resolves `XRAY_CORE` to the factory above.
    const appInterceptorBinding: Provider = {
      provide: 'APP_INTERCEPTOR',
      useClass: XrayInterceptor,
    };

    return {
      module: NodeXrayModule,
      global: true,
      providers: [
        coreProvider,
        serviceProvider,
        appInterceptorBinding,
        XRayService,
        XrayInterceptor,
      ],
      exports: [XRAY_SERVICE, XRayService],
    };
  }
}
