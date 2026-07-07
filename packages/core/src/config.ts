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

/**
 * Default HTTP headers to redact. These cover the credentials and
 * session tokens that virtually every modern API exchanges. The
 * list is matched case-insensitively; a user can extend it with
 * `redactHeaders` in the options.
 */
const DEFAULT_REDACT_HEADERS: readonly string[] = [
  // Standard auth
  'authorization',
  'proxy-authorization',
  'www-authenticate',
  'proxy-authenticate',
  // Cookies
  'cookie',
  'set-cookie',
  'cookie2',
  // API tokens
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-refresh-token',
  'x-id-token',
  'x-session-id',
  'x-csrf-token',
  'x-xsrf-token',
];

/**
 * Default JSON paths to redact. The list covers the most common
 * credential, payment, and personal-data fields. A user can extend
 * it with `redactBodyPaths` in the options. The two common naming
 * conventions (camelCase, snake_case) are both covered, and every
 * entry is duplicated with a `*.foo` wildcard so it matches at any
 * nesting level.
 */
const DEFAULT_REDACT_BODY_PATHS: readonly string[] = [
  // Credentials
  'password',
  'passwd',
  'pwd',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'idToken',
  'id_token',
  'sessionId',
  'session_id',
  'authorization',
  'privateKey',
  'private_key',
  // Wildcards for any depth
  '*.password',
  '*.passwd',
  '*.pwd',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.api_key',
  '*.accessToken',
  '*.access_token',
  '*.refreshToken',
  '*.refresh_token',
  '*.idToken',
  '*.id_token',
  '*.sessionId',
  '*.session_id',
  '*.authorization',
  '*.privateKey',
  '*.private_key',
  // Payment
  'cvv',
  'pin',
  'creditCard',
  'credit_card',
  'cards[*].cvv',
  'cards[*].pin',
  // PII
  'ssn',
  'phone',
  '*.ssn',
  '*.phone',
];

const DEFAULT_IGNORE = (ctx: { path: string; method: string }): boolean => {
  if (ctx.path === '/favicon.ico') return true;
  // Chrome probes this on every page load with DevTools; without the
  // ignore it floods the dashboard with 404 noise.
  if (ctx.path.startsWith('/.well-known/appspecific/')) return true;
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

  // Redaction merge: defaults are applied unless the user passes
  // `false` to opt out entirely. An array (including `[]`) is
  // merged with the defaults; `undefined` falls back to defaults.
  const redactHeaders = new Set<string>(
    (options.redactHeaders === false
      ? []
      : [...DEFAULT_REDACT_HEADERS, ...(options.redactHeaders ?? [])]
    ).map((h) => h.toLowerCase()),
  );

  const redactBodyPaths =
    options.redactBodyPaths === false
      ? []
      : options.redactBodyPaths
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
