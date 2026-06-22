import { AsyncLocalStorage } from 'node:async_hooks';
import type { XRayContext } from '@node-xray/types';
import { XRayNoContextError } from './errors.js';

/**
 * The single `AsyncLocalStorage` instance backing the request context.
 *
 * One instance per process. Adapters obtain the store via this module
 * and call `als.run(ctx, next)`. Downstream code reads via `getContext()`.
 *
 * The store is intentionally not exposed publicly; consumers must use
 * the `getContext` / `withTags` / `withContext` helpers.
 */
const als = new AsyncLocalStorage<XRayContext>();

/**
 * Returns the current async-local context, or `undefined` if called
 * outside a tracked request.
 */
export function getContext(): XRayContext | undefined {
  return als.getStore();
}

/**
 * Same as `getContext`, but throws `XRayNoContextError` if there is no
 * active context. Use in libraries that must run inside a request.
 */
export function getContextOrThrow(): XRayContext {
  const ctx = als.getStore();
  if (!ctx) throw new XRayNoContextError();
  return ctx;
}

/**
 * Run `fn` inside a new context where the tags are merged in. The
 * original context is restored when `fn` returns or throws.
 *
 * Does not start or end a request — that is the adapter's job.
 */
export async function withTags(
  tags: Record<string, string | number | boolean>,
  fn: () => Promise<unknown> | unknown,
): Promise<unknown> {
  const parent = als.getStore();
  if (!parent) return fn();
  const child: XRayContext = {
    ...parent,
    tags: { ...parent.tags, ...tags },
  };
  return als.run(child, fn);
}

/**
 * Run `fn` inside a copy of `ctx`. Use this to start a child span from
 * an existing context.
 */
export async function withContext(
  ctx: XRayContext,
  fn: () => Promise<unknown> | unknown,
): Promise<unknown> {
  return als.run(ctx, fn);
}

/**
 * Run `fn` inside `ctx` without consuming a return value. Synchronous
 * helper used by adapters to wrap a request boundary.
 */
export function runWithContext<T>(ctx: XRayContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/**
 * Test-only escape hatch. Returns the underlying `AsyncLocalStorage`
 * instance. Not exported from the public barrel.
 */
export function _alsForTest(): AsyncLocalStorage<XRayContext> {
  return als;
}
