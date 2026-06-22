/**
 * Public option shape for `@node-xray/core` and all framework adapters.
 *
 * The shape is identical across adapters; adapters may extend it with
 * framework-specific knobs but should not narrow required fields.
 *
 * Detailed documentation lives in `docs/CONFIGURATION.md`. The full
 * option matrix is finalised in P1.
 */
export interface XRayOptions {
  enabled?: boolean;
  path?: string;
  captureRequestBody?: boolean;
  captureResponseBody?: boolean;
  maxBodySize?: number;
  maxRequests?: number;
  ignore?: (ctx: { path: string }) => boolean;
  redactHeaders?: readonly string[];
  redactBodyPaths?: readonly string[];
  sampleRate?: number;
  stack?: {
    enabled?: boolean;
    rate?: number;
    maxFrames?: number;
  };
  websocket?: {
    enabled?: boolean;
    maxClients?: number;
  };
  auth?:
    | { type: 'basic'; user: string; pass: string }
    | { type: 'bearer'; token: string }
    | { type: 'custom'; verify: (req: unknown) => boolean | Promise<boolean> };
  onError?: (err: Error, ctx: unknown) => void;
}
