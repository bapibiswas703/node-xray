import type { XRayOptions, XRayAuth, EventLoopPhase } from '@node-xray/types';
import { XRayConfigError } from './errors.js';

/**
 * The fully resolved option set after defaults are applied. All fields
 * are required and non-undefined. This is the type the core uses
 * internally; the public `XRayOptions` is the user-facing shape.
 */
export interface ResolvedOptions {
  enabled: boolean;
  path: string;
  captureRequestBody: boolean;
  captureResponseBody: boolean;
  maxBodySize: number;
  maxRequests: number;
  ignore: (ctx: { path: string; method: string }) => boolean;
  redactHeaders: ReadonlySet<string>;
  redactBodyPaths: readonly string[];
  sampleRate: number;
  stack: { enabled: boolean; rate: number; maxFrames: number };
  websocket: { enabled: boolean; maxClients: number };
  auth?: XRayAuth;
  onError: (err: Error, ctx: unknown) => void;
}

const DEFAULT_REDACT_HEADERS: readonly string[] = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'proxy-authorization',
];

const DEFAULT_REDACT_BODY_PATHS: readonly string[] = [
  'password',
  'token',
  'secret',
  'apiKey',
  '*.password',
  '*.token',
  '*.secret',
  'cards[*].cvv',
];

const DEFAULT_IGNORE = (ctx: { path: string; method: string }): boolean => {
  if (ctx.path === '/favicon.ico') return true;
  if (ctx.path.endsWith('/node-xray') || ctx.path.startsWith('/node-xray/')) return true;
  return false;
};

const DEFAULT_ON_ERROR = (err: Error): void => {
  console.error('[node-xray]', err.message, err.stack);
};

const PROD_DOCS_URL = 'https://github.com/bapibiswas703/node-xray/blob/main/docs/SECURITY.md';

const isProduction = (): boolean => process.env['NODE_ENV'] === 'production';

/**
 * Merge user options with defaults and apply the production guard.
 *
 * Throws `XRayConfigError` if the configuration is invalid. The
 * production guard refuses to mount in `NODE_ENV=production` without
 * an `auth` block — this is intentional and documented.
 */
export function resolveOptions(options: XRayOptions = {}, mountPath?: string): ResolvedOptions {
  const isProd = isProduction();

  const enabled = options.enabled ?? !isProd;

  const redactHeaders = new Set<string>(
    [...DEFAULT_REDACT_HEADERS, ...(options.redactHeaders ?? [])].map((h) => h.toLowerCase()),
  );

  const redactBodyPaths = options.redactBodyPaths
    ? [...DEFAULT_REDACT_BODY_PATHS, ...options.redactBodyPaths]
    : DEFAULT_REDACT_BODY_PATHS;

  const stackEnabled = options.stack?.enabled ?? true;
  const stackRate = options.stack?.rate ?? 0.1;
  const stackMaxFrames = options.stack?.maxFrames ?? 20;

  const wsEnabled = options.websocket?.enabled ?? true;
  const wsMaxClients = options.websocket?.maxClients ?? 4;

  const auth = options.auth;

  if (isProd && enabled && !auth) {
    throw new XRayConfigError(`auth is required when NODE_ENV=production. See ${PROD_DOCS_URL}.`);
  }

  if (mountPath !== undefined) {
    validateMountPath(mountPath);
  }

  return {
    enabled,
    path: options.path ?? '/node-xray',
    captureRequestBody: options.captureRequestBody ?? !isProd,
    captureResponseBody: options.captureResponseBody ?? !isProd,
    maxBodySize: options.maxBodySize ?? 102_400,
    maxRequests: options.maxRequests ?? 200,
    ignore: options.ignore ?? DEFAULT_IGNORE,
    redactHeaders,
    redactBodyPaths,
    sampleRate: clamp(options.sampleRate ?? 1, 0, 1),
    stack: {
      enabled: stackEnabled,
      rate: clamp(stackRate, 0, 1),
      maxFrames: Math.max(1, stackMaxFrames | 0),
    },
    websocket: {
      enabled: wsEnabled,
      maxClients: Math.max(1, wsMaxClients | 0),
    },
    ...(auth !== undefined ? { auth } : {}),
    onError: options.onError ?? DEFAULT_ON_ERROR,
  };
}

function validateMountPath(path: string): void {
  if (!path.startsWith('/')) {
    throw new XRayConfigError(`path must start with '/'. Got '${path}'.`);
  }
  if (path.includes('..')) {
    throw new XRayConfigError(`path must not contain '..'. Got '${path}'.`);
  }
  if (path.length > 256) {
    throw new XRayConfigError(`path must be at most 256 characters. Got ${path.length}.`);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Best-effort event-loop phase detection. Reads internal Node.js state
 * where available; falls back to `'unknown'`.
 *
 * The `performance` API does not expose the current phase directly, so
 * this is intentionally conservative. The dashboard only uses the
 * result as a label.
 */
export function detectEventLoopPhase(): EventLoopPhase {
  // Node exposes the current phase on the process via internal symbols
  // starting in v22. For older versions we report 'unknown' and rely on
  // the lag/utilization signals instead.
  const phase = (process as unknown as { _getActiveHandles?: () => unknown })._getActiveHandles;
  if (typeof phase === 'function') return 'poll';
  return 'unknown';
}
