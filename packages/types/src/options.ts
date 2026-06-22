/**
 * Public option shape for `@node-xray/core` and all framework adapters.
 *
 * The shape is identical across adapters; adapters may extend it with
 * framework-specific knobs but should not narrow required fields.
 *
 * Detailed documentation lives in `docs/CONFIGURATION.md`.
 */
export interface XRayOptions {
  /**
   * Master switch. When false, the adapter is a no-op.
   * @default `process.env.NODE_ENV !== 'production'`
   */
  enabled?: boolean;

  /**
   * Mount path of the dashboard and the WebSocket.
   * The WebSocket is served at `${path}/ws`.
   * @default '/node-xray'
   */
  path?: string;

  /**
   * Whether to capture the parsed request body.
   * @default true in dev, false in prod
   */
  captureRequestBody?: boolean;

  /**
   * Whether to capture the response payload.
   * @default true in dev, false in prod
   */
  captureResponseBody?: boolean;

  /**
   * Hard cap, in bytes, on a single body. Larger bodies are replaced with
   * `{ __truncated: true, originalSize }`.
   * @default 102_400 (100 KB)
   */
  maxBodySize?: number;

  /**
   * Maximum number of records kept in the in-memory ring buffer.
   * @default 200
   */
  maxRequests?: number;

  /**
   * Predicate that returns true for requests that should not be recorded.
   * Runs before body capture, so ignored requests cost almost nothing.
   */
  ignore?: (ctx: { path: string; method: string }) => boolean;

  /**
   * Header names (case-insensitive) whose values are replaced with
   * `'[REDACTED]'`. Merged with the default deny list.
   */
  redactHeaders?: readonly string[];

  /**
   * JSON-path-style expressions for body field redaction. See
   * `docs/SECURITY.md` for the supported syntax.
   */
  redactBodyPaths?: readonly string[];

  /**
   * Fraction of requests to record. 0..1.
   * @default 1
   */
  sampleRate?: number;

  /**
   * Stack capture configuration.
   */
  stack?: {
    /** @default true */
    enabled?: boolean;
    /** Fraction of requests that get a full stack. 0..1. @default 0.1 */
    rate?: number;
    /** Maximum number of frames kept after sanitization. @default 20 */
    maxFrames?: number;
  };

  /**
   * WebSocket hub configuration.
   */
  websocket?: {
    /** @default true */
    enabled?: boolean;
    /** Hard cap on concurrent dashboard tabs. @default 4 */
    maxClients?: number;
  };

  /**
   * Auth gate for the dashboard route and the WebSocket upgrade.
   * Required in `NODE_ENV=production` (the adapter throws at startup otherwise).
   */
  auth?: XRayAuth;

  /**
   * Receiver for every internal error. The default is `console.error`
   * with a `[node-xray]` prefix. Must not throw.
   */
  onError?: (err: Error, ctx: unknown) => void;
}

export type XRayAuth =
  | { type: 'basic'; user: string; pass: string }
  | { type: 'bearer'; token: string }
  | { type: 'custom'; verify: (req: XRayAuthRequest) => boolean | Promise<boolean> };

/**
 * Minimal request shape passed to custom auth `verify` functions.
 * Adapters normalize the framework-specific request into this shape.
 */
export interface XRayAuthRequest {
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  remoteAddress?: string;
}
