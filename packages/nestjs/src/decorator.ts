import { SetMetadata } from '@nestjs/common';

export const XRAY_TRACE_KEY = 'node-xray:trace';

/**
 * Mark a controller or service method for explicit node-xray tracing.
 * The decorator adds the supplied label as a tag on the in-flight
 * async context, so the dashboard shows the method as a tracked
 * span.
 *
 * ```ts
 * @XrayTrace('orders.create')
 * @Post()
 * async create(@Body() dto: CreateOrderDto) {
 *   // ...
 * }
 * ```
 */
export function XRayTrace(label: string): MethodDecorator {
  return SetMetadata(XRAY_TRACE_KEY, label) as MethodDecorator;
}
