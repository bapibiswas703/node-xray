import { describe, it, expect } from 'vitest';
import {
  getContext,
  getContextOrThrow,
  withTags,
  withContext,
  runWithContext,
  RECORD_TAGS_REF,
} from './context.js';
import { XRayNoContextError } from './errors.js';
import type { XRayContext } from '@node-xray/types';

function makeContext(overrides: Partial<XRayContext> = {}): XRayContext {
  return {
    requestId: 'req_1',
    traceId: 'trace_1',
    spanId: 'span_1',
    framework: 'custom',
    method: 'get',
    path: '/',
    startedAt: 0n,
    tags: { existing: true },
    refs: new Map(),
    ...overrides,
  };
}

describe('context', () => {
  it('getContext returns undefined when no context is active', () => {
    expect(getContext()).toBeUndefined();
  });

  it('getContextOrThrow throws when no context is active', () => {
    expect(() => getContextOrThrow()).toThrow(XRayNoContextError);
  });

  it('getContext returns the active context inside runWithContext', () => {
    const ctx = makeContext();
    const inside = runWithContext(ctx, () => getContext());
    expect(inside).toBe(ctx);
  });

  it('withTags merges tags and restores the parent context after', async () => {
    const parent = makeContext({ tags: { a: 1, b: 2 } });
    const result = await runWithContext(parent, async () => {
      await withTags({ b: 3, c: 4 }, async () => {
        const inside = getContextOrThrow();
        expect(inside.tags).toEqual({ a: 1, b: 3, c: 4 });
      });
      const after = getContextOrThrow();
      expect(after.tags).toEqual({ a: 1, b: 2 });
      return 'done';
    });
    expect(result).toBe('done');
  });

  it('withTags writes into the RECORD_TAGS_REF accumulator so tags outlive the scope', async () => {
    const acc: Record<string, string | number | boolean> = {};
    const parent = makeContext({
      tags: {},
      refs: new Map<string, unknown>([[RECORD_TAGS_REF, acc]]),
    });
    await runWithContext(parent, async () => {
      await withTags({ userId: 42 }, async () => {
        await withTags({ nested: true }, async () => {
          /* scoped */
        });
      });
    });
    // The lexical scopes are gone, but the accumulator kept everything.
    expect(acc).toEqual({ userId: 42, nested: true });
  });

  it('withTags is a no-op when no context is active', async () => {
    let seen: number | undefined;
    await withTags({ x: 1 }, async () => {
      seen = getContext()?.tags['x'] as number;
    });
    expect(seen).toBeUndefined();
  });

  it('withContext runs fn inside the new context', async () => {
    const child = makeContext({ requestId: 'child' });
    const seen = await withContext(child, async () => getContextOrThrow().requestId);
    expect(seen).toBe('child');
  });

  it('context survives an await', async () => {
    const ctx = makeContext();
    const seen = await runWithContext(ctx, async () => {
      await Promise.resolve();
      return getContext()?.requestId;
    });
    expect(seen).toBe('req_1');
  });

  it('context survives setTimeout', async () => {
    const ctx = makeContext();
    const seen = await runWithContext(ctx, () => {
      return new Promise<string | undefined>((resolve) => {
        setTimeout(() => resolve(getContext()?.requestId), 5);
      });
    });
    expect(seen).toBe('req_1');
  });
});
