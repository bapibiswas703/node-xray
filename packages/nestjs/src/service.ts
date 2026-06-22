import { Injectable, Inject, type OnModuleDestroy } from '@nestjs/common';
import type { Core, RequestStore } from '@node-xray/core';
import { withTags } from '@node-xray/core';

export const XRAY_CORE = Symbol.for('@node-xray/nestjs.Core');

/**
 * NestJS-injectable service that wraps a `Core` instance.
 *
 * Inject it anywhere in your application to:
 *  - Read the ring buffer (`store`).
 *  - Read the resolved options (`options`).
 *  - Wrap a unit of work in tagged context (`withTags`).
 *  - Mark a method with `@XrayTrace()` for explicit tracing.
 *
 * In typical use, `XRayService` is a singleton bound to the
 * `NodeXrayModule.register()` factory. The `core` is the same
 * instance consumed by the global `XrayInterceptor`.
 */
@Injectable()
export class XRayService implements OnModuleDestroy {
  constructor(@Inject(XRAY_CORE) private readonly core: Core) {}

  /** The underlying `Core` instance. Exposed for advanced sinks. */
  getCore(): Core {
    return this.core;
  }

  /** The resolved options (defaults applied, clamps applied). */
  getOptions(): Core['options'] {
    return this.core.options;
  }

  /** The ring-buffer store. */
  getStore(): RequestStore {
    return this.core.store;
  }

  /**
   * Run `fn` with extra tags applied to the current async context.
   * No-op if no context is active. Useful for cross-cutting tagging:
   *
   * ```ts
   * await this.xray.withTags({ userId: 42 }, () => this.db.find(42));
   * ```
   */
  async withTags<T>(
    tags: Record<string, string | number | boolean>,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    return (await withTags(tags, fn)) as T;
  }

  /**
   * Lifecycle hook. Closes the core (stops the loop monitor and the
   * WebSocket hub) on application shutdown. Wired by NestJS.
   */
  async onModuleDestroy(): Promise<void> {
    await this.core.close();
  }
}
