/**
 * @node-xray/nestjs
 *
 * NestJS module adapter. Implementation lands in P4.
 * The P0 stub exposes the module shape so the build chain is testable.
 */

import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { XRayOptions } from '@node-xray/core';

@Module({})
export class NodeXrayModule {
  /**
   * Register the module globally. P0 stub: returns an empty module.
   * P4 implementation will register a global HTTP interceptor and
   * expose `XRayService` plus the `@XrayTrace()` decorator.
   */
  static register(_options: XRayOptions = {}): DynamicModule {
    return {
      module: NodeXrayModule,
      global: true,
    };
  }
}
