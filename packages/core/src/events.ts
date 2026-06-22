import type { XRayEventName, XRayEventPayload } from '@node-xray/types';

type Listener<T> = (payload: T) => void;

const listeners: { [K in XRayEventName]: Set<Listener<XRayEventPayload[K]>> } = {
  'request:new': new Set(),
  'request:update': new Set(),
  'request:done': new Set(),
  loop: new Set(),
  error: new Set(),
};

let emitDepth = 0;
const MAX_EMIT_DEPTH = 16;

/**
 * Register a listener for a typed event. Returns an unsubscribe function.
 *
 * The bus is synchronous. Listeners are invoked in registration order.
 * Slow listeners slow down whatever triggered the event; the WS hub
 * and the request-finish path use this bus, so be careful.
 */
export function on<K extends XRayEventName>(
  name: K,
  listener: Listener<XRayEventPayload[K]>,
): () => void {
  const set = listeners[name] as Set<Listener<XRayEventPayload[K]>>;
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/** Remove a specific listener. Pair with `on`. */
export function off<K extends XRayEventName>(
  name: K,
  listener: Listener<XRayEventPayload[K]>,
): void {
  const set = listeners[name] as Set<Listener<XRayEventPayload[K]>>;
  set.delete(listener);
}

/**
 * Synchronously dispatch an event. Recursion is bounded by
 * `MAX_EMIT_DEPTH` so a listener that re-emits cannot deadlock the bus.
 */
export function emit<K extends XRayEventName>(name: K, payload: XRayEventPayload[K]): void {
  if (emitDepth >= MAX_EMIT_DEPTH) return;
  emitDepth++;
  try {
    const set = listeners[name] as Set<Listener<XRayEventPayload[K]>>;
    for (const listener of set) {
      try {
        listener(payload);
      } catch (err) {
        // A misbehaving listener must not break the bus. The error is
        // re-emitted as an `error` event, but only if we're not already
        // inside an `error` dispatch (which would recurse).
        if (name !== 'error') {
          emit('error', err instanceof Error ? err : new Error(String(err)));
        }
      }
    }
  } finally {
    emitDepth--;
  }
}

/** Number of registered listeners, per event. Useful for tests. */
export function listenerCount<K extends XRayEventName>(name: K): number {
  return (listeners[name] as Set<unknown>).size;
}

/** Remove every listener. Test-only. */
export function _clearAllForTest(): void {
  for (const key of Object.keys(listeners) as XRayEventName[]) {
    (listeners[key] as Set<unknown>).clear();
  }
}
