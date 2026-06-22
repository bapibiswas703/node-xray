import type { XRayOptions } from '@node-xray/types';
import type { Core } from '@node-xray/core';
import type { Type, DynamicModule } from '@nestjs/common';

/**
 * Options for `NodeXrayModule.register()`. A superset of the public
 * `XRayOptions` with NestJS-specific knobs.
 */
export interface XRayNestjsOptions extends XRayOptions {
  /**
   * Whether to install the global HTTP interceptor. Default `true`.
   * Set to `false` to opt out of automatic HTTP capture (e.g. for
   * applications that want to drive `XRayService` manually only).
   */
  intercept?: boolean;
}

/**
 * The handle returned by `NodeXrayModule.register()`. Exposes the
 * `Core`, the `XRayService` token, and the resolved options.
 */
export interface XRayNestjsHandle {
  readonly core: Core;
  readonly options: Core['options'];
  readonly service: symbol;
}

/**
 * Public factory signature. The return type is the same shape that
 * NestJS users pass to `imports: [NodeXrayModule.register(...)]`.
 */
export interface XRayModuleOptions {
  useFactory: (...args: unknown[]) => XRayNestjsHandle;
  inject?: unknown[];
}

export interface XRayModuleAsyncOptions {
  imports?: unknown[];
  useFactory: (...args: unknown[]) => XRayNestjsHandle;
  inject?: unknown[];
}

export type XRayRequest = {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  path: string;
  url?: string;
  route?: string | { path?: string };
  raw?: { socket?: { server?: unknown } };
  socket?: { server?: unknown };
};

export type XRayResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

export type { DynamicModule, Type };
