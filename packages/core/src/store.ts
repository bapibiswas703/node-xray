import type { RequestRecord, TimelineEntry, AsyncOp, SnapshotSide } from '@node-xray/types';
import { emit } from './events.js';

const TIMELINE_CAP = 500;
const ASYNC_OP_CAP = 200;

export interface StoreOptions {
  maxRequests: number;
}

/**
 * The in-memory request store. A single instance per process.
 *
 * Single-writer (the request-finish path), multi-reader (the WS hub,
 * custom sinks, test code). The internal array is never exposed
 * directly; consumers receive readonly snapshots.
 */
export class RequestStore {
  readonly #max: number;
  readonly #buffer: RequestRecord[] = [];
  readonly #subscribers = new Set<(records: readonly RequestRecord[]) => void>();

  constructor(options: StoreOptions) {
    if (options.maxRequests < 1) {
      throw new RangeError('maxRequests must be >= 1');
    }
    this.#max = options.maxRequests;
  }

  /** Current number of records in the buffer. */
  get size(): number {
    return this.#buffer.length;
  }

  /** Configured capacity. */
  get capacity(): number {
    return this.#max;
  }

  /** Insert a new partial record (status 0). Triggers a snapshot emit. */
  add(record: RequestRecord): void {
    if (this.#buffer.length >= this.#max) {
      this.#buffer.shift();
    }
    this.#buffer.push(record);
    emit('request:new', record);
    this.#broadcast();
  }

  /**
   * Apply a partial patch to an existing record by id. No-op if the
   * record is not found (it may have been evicted).
   */
  update(id: string, patch: Partial<RequestRecord>): void {
    const idx = this.#buffer.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const current = this.#buffer[idx];
    if (!current) return;
    this.#buffer[idx] = { ...current, ...patch };
    emit('request:update', { id, patch });
    this.#broadcast();
  }

  /**
   * Mark a record as done. Replaces it in place with the final version
   * (status, durationMs, response, error, timeline, asyncOps).
   */
  finish(record: RequestRecord): void {
    const idx = this.#buffer.findIndex((r) => r.id === record.id);
    if (idx === -1) {
      // Insert at the end if it wasn't there (e.g. sampled out earlier).
      if (this.#buffer.length >= this.#max) this.#buffer.shift();
      this.#buffer.push(record);
    } else {
      this.#buffer[idx] = record;
    }
    emit('request:done', record);
    this.#broadcast();
  }

  /** Return a readonly snapshot of the buffer, newest last. */
  list(): readonly RequestRecord[] {
    return this.#buffer.slice();
  }

  /** Look up a record by id. */
  get(id: string): RequestRecord | undefined {
    return this.#buffer.find((r) => r.id === id);
  }

  /** Empty the buffer. */
  clear(): void {
    this.#buffer.length = 0;
    this.#broadcast();
  }

  /**
   * Subscribe to buffer changes. The callback receives a fresh readonly
   * snapshot every time the buffer changes. Returns an unsubscribe.
   */
  subscribe(fn: (records: readonly RequestRecord[]) => void): () => void {
    this.#subscribers.add(fn);
    fn(this.list());
    return () => {
      this.#subscribers.delete(fn);
    };
  }

  #broadcast(): void {
    if (this.#subscribers.size === 0) return;
    const snap = this.list();
    for (const fn of this.#subscribers) {
      try {
        fn(snap);
      } catch {
        // Subscriber errors must not break the store.
      }
    }
  }
}

/**
 * Allocate a fresh, partial `RequestRecord`. The adapter calls this at
 * the start of a request and fills in the rest.
 */
export function createPartialRecord(input: {
  id: string;
  method: string;
  path: string;
  route?: string;
  framework: 'express' | 'fastify' | 'nestjs' | 'custom';
  request: SnapshotSide;
}): RequestRecord {
  return {
    id: input.id,
    method: input.method,
    path: input.path,
    ...(input.route !== undefined ? { route: input.route } : {}),
    status: 0,
    startedAt: Date.now(),
    durationMs: null,
    timeline: [],
    asyncOps: [],
    request: input.request,
    response: { headers: {} },
    framework: input.framework,
    tags: {},
  };
}

/**
 * Append a timeline entry to a record, capping the array at
 * `TIMELINE_CAP`. Pure; returns a new record.
 */
export function appendTimeline(record: RequestRecord, entry: TimelineEntry): RequestRecord {
  const timeline =
    record.timeline.length >= TIMELINE_CAP ? record.timeline : [...record.timeline, entry];
  return { ...record, timeline };
}

/**
 * Append an async op, capping the array at `ASYNC_OP_CAP`. Pure;
 * returns a new record.
 */
export function appendAsyncOp(record: RequestRecord, op: AsyncOp): RequestRecord {
  const asyncOps =
    record.asyncOps.length >= ASYNC_OP_CAP ? record.asyncOps : [...record.asyncOps, op];
  return { ...record, asyncOps };
}
