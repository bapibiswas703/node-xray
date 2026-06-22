/**
 * Redaction. Two surfaces:
 *
 *  - Headers: a default-deny list of case-insensitive header names. The
 *    value is replaced with the literal string `'[REDACTED]'` regardless
 *    of original length, to avoid length-based side channels.
 *
 *  - Bodies: a JSON-path-style walker that replaces values at configured
 *    paths. The walker is depth-limited (default 16) and detects cycles.
 *
 * Path syntax:
 *  - `password`               — top-level key
 *  - `*.token`                — any nested `token`
 *  - `cards[*].cvv`           — `cvv` inside any `cards[*]`
 *  - `a.b.c`                  — deep path
 */

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 16;

export interface RedactOptions {
  redactHeaders: ReadonlySet<string>;
  redactBodyPaths: readonly string[];
}

/**
 * Redact headers in a `Record<string, string>` (or string|string[]
 * variant). Returns a new object; the input is not mutated.
 */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
  deny: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (deny.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.join(', ');
    } else if (value === undefined) {
      out[key] = '';
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Redact fields in a JSON body. Returns the redacted clone. The input
 * is not mutated.
 */
export function redactBody(value: unknown, paths: readonly string[]): unknown {
  if (paths.length === 0) return value;
  if (value === null || typeof value !== 'object') return value;
  const compiled = paths.map(compilePath);
  return walk(value, compiled, [], new WeakSet(), 0);
}

interface CompiledPath {
  segments: PathSegment[];
}

type PathSegment =
  | { kind: 'key'; value: string }
  | { kind: 'any-key' } // `*`
  | { kind: 'any-array' }; // `[*]`

function compilePath(path: string): CompiledPath {
  const segments: PathSegment[] = [];
  for (const raw of path.split('.')) {
    if (raw === '*') {
      segments.push({ kind: 'any-key' });
      continue;
    }
    const arrayMatch = /^(.+?)\[\*\]$/.exec(raw);
    if (arrayMatch && arrayMatch[1]) {
      segments.push({ kind: 'key', value: arrayMatch[1] });
      segments.push({ kind: 'any-array' });
      continue;
    }
    segments.push({ kind: 'key', value: raw });
  }
  return { segments };
}

function walk(
  value: unknown,
  paths: CompiledPath[],
  matchedSoFar: CompiledPath[],
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) return '[DEPTH]';
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[CYCLE]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => {
      // Check whether any remaining path segment expects an array here.
      const advanced = advancePaths(matchedSoFar, paths, undefined, true);
      if (advanced.paths.some((p) => p.segments.length === 0)) {
        return REDACTED;
      }
      return walk(item, advanced.paths, advanced.matched, seen, depth + 1);
    });
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const advanced = advancePaths(matchedSoFar, paths, key, false);
    if (advanced.exhausted) {
      out[key] = REDACTED;
      continue;
    }
    if (advanced.paths.length === 0) {
      out[key] = child;
      continue;
    }
    out[key] = walk(child, advanced.paths, advanced.matched, seen, depth + 1);
  }
  return out;
}

interface Advanced {
  /** Paths still to match. Empty means no further matching. */
  paths: CompiledPath[];
  /** Path heads we have advanced past, to be re-checked against siblings. */
  matched: CompiledPath[];
  /** True if some path matched all segments and we should redact. */
  exhausted: boolean;
}

function advancePaths(
  matchedSoFar: CompiledPath[],
  paths: CompiledPath[],
  key: string | undefined,
  isArray: boolean,
): Advanced {
  const matched = matchedSoFar.slice();
  const remaining: CompiledPath[] = [];
  let exhausted = false;

  for (const p of paths) {
    // If this path was already fully consumed at a parent level,
    // any descendant (including key-less array children) is redacted.
    if (p.segments.length === 0) {
      exhausted = true;
      continue;
    }
    const head = p.segments[0];
    if (!head) continue;
    if (matches(head, key, isArray)) {
      const next: CompiledPath = { segments: p.segments.slice(1) };
      if (next.segments.length === 0) {
        exhausted = true;
      } else {
        matched.push(next);
        remaining.push(next);
      }
    } else {
      // Path does not apply to this branch; keep it for siblings.
      remaining.push(p);
    }
  }

  return { paths: remaining, matched, exhausted };
}

function matches(head: PathSegment, key: string | undefined, isArray: boolean): boolean {
  if (head.kind === 'any-key') {
    return isArray ? false : true;
  }
  if (head.kind === 'any-array') {
    return isArray;
  }
  if (isArray) return false;
  return head.value === key;
}

/**
 * Truncate a body that exceeds `maxBytes` after JSON serialization.
 * Returns a marker object that is itself valid JSON.
 */
export function truncateBody(value: unknown, maxBytes: number): unknown {
  let size: number;
  try {
    size = JSON.stringify(value)?.length ?? 0;
  } catch {
    return { __truncated: true, originalSize: 0, reason: 'unserializable' };
  }
  if (size <= maxBytes) return value;
  return { __truncated: true, originalSize: size };
}

/**
 * Combined helper: redact and truncate in a single call. Used by the
 * adapter body-capture path.
 */
export function redactSnapshot(body: unknown, paths: readonly string[], maxBytes: number): unknown {
  const redacted = redactBody(body, paths);
  return truncateBody(redacted, maxBytes);
}
