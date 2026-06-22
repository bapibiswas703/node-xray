/**
 * Base class for every error thrown or surfaced by `node-xray`.
 *
 * Subclasses carry a stable `code` string so consumers can match without
 * `instanceof` chains. The `code` is also serialized over the wire in
 * `ErrorFrame.payload.code`.
 */
export class XRayError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'XRayError';
    // Maintain proper prototype chain for `instanceof` after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when user code calls `getContextOrThrow()` outside a request. */
export class XRayNoContextError extends XRayError {
  constructor() {
    super(
      'No xray context is active. Called outside a tracked request, or the adapter is disabled.',
      'XRAY_NO_CONTEXT',
    );
    this.name = 'XRayNoContextError';
  }
}

/**
 * Thrown at registration time when the configuration is invalid (e.g.
 * missing `auth` in production, conflicting `path`).
 */
export class XRayConfigError extends XRayError {
  constructor(message: string) {
    super(message, 'XRAY_CONFIG');
    this.name = 'XRayConfigError';
  }
}

/** Thrown when the WebSocket protocol is violated by a client. */
export class XRayWireError extends XRayError {
  constructor(message: string) {
    super(message, 'XRAY_WIRE');
    this.name = 'XRayWireError';
  }
}

/**
 * Reserved for future use. The store is bounded and never throws on
 * overflow, but downstream sinks may want to match on this code.
 */
export class XRayStoreFullError extends XRayError {
  constructor() {
    super('XRay store is full and could not evict.', 'XRAY_STORE_FULL');
    this.name = 'XRayStoreFullError';
  }
}
