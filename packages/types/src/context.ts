/**
 * The async-local context attached to every request.
 *
 * Created by the framework adapter at the request boundary and read by
 * user code via `getContext()` from `@node-xray/core`. Survives across
 * `await`, `setTimeout`, microtasks, and `worker_threads` callbacks.
 */
export interface XRayContext {
  /** ULID, monotonic. Unique per request. */
  requestId: string;
  /** Shared across a logical user action. */
  traceId: string;
  /** Unique per logical operation. */
  spanId: string;
  /** Parent span, if this is a child. */
  parentSpanId?: string;
  /** Framework that created the context. */
  framework: 'express' | 'fastify' | 'nestjs' | 'custom';
  /** Matched route, not the raw URL (e.g. `/api/users/:id`). */
  route?: string;
  /** HTTP method, lowercased. */
  method: string;
  /** Raw request path. */
  path: string;
  /** `process.hrtime.bigint()` at the start of the request. */
  startedAt: bigint;
  /** Free-form key/value annotations. */
  tags: Record<string, string | number | boolean>;
  /** Escape hatch for adapters to stash framework-specific data. */
  refs: Map<string, unknown>;
}
