/**
 * Sanitized stack capture.
 *
 * The native `Error.stack` is a string with file paths and absolute
 * URLs that leak repo layout and machine names. We use
 * `Error.prepareStackTrace` to get structured frames, then strip
 * `node_modules` and rewrite paths to a short form.
 *
 * The capture is sampled (default 10% of requests) to keep the
 * per-request cost bounded.
 */

export interface CaptureOptions {
  /** Fraction of calls that should produce a real stack. 0..1. */
  rate: number;
  /** Maximum number of frames kept after sanitization. */
  maxFrames: number;
}

const INTERNAL_FRAME_RE = /\/node_modules\//;
const FRAME_LINE_RE = /at\s+(?:.+\s+\()?(.+?):\d+:\d+\)?$/;
const FILE_PATH_RE = /^(.*[\\/])([^\\/]+)$/;

/**
 * Capture a sanitized stack for the current call site.
 *
 * Returns `undefined` if the sample was skipped. The call site is at
 * `depth + 1` frames below the caller.
 */
export function captureStack(options: CaptureOptions, depth = 1): string[] | undefined {
  if (options.rate <= 0) return undefined;
  if (options.rate < 1 && Math.random() > options.rate) return undefined;

  const prev = Error.prepareStackTrace;
  Error.prepareStackTrace = (_err, stack) => stack;
  const err = new Error();
  const stack = err.stack as unknown as NodeJS.CallSite[] | undefined;
  Error.prepareStackTrace = prev;

  if (!stack) return undefined;

  const out: string[] = [];
  for (let i = depth; i < stack.length && out.length < options.maxFrames; i++) {
    const site = stack[i];
    if (!site) continue;
    const file = site.getFileName() ?? '<anon>';
    if (INTERNAL_FRAME_RE.test(file)) {
      if (out.length === 0) out.push('… (node_modules)');
      continue;
    }
    out.push(formatFrame(site, file));
  }
  return out;
}

function formatFrame(site: NodeJS.CallSite, file: string): string {
  const functionName = site.getFunctionName() ?? site.getTypeName() ?? '<anon>';
  const shortFile = shortenPath(file);
  const line = site.getLineNumber();
  const column = site.getColumnNumber();
  return `${functionName} (${shortFile}:${line}:${column})`;
}

function shortenPath(file: string): string {
  if (!file || file === '<anon>') return '<anon>';
  const match = FILE_PATH_RE.exec(file);
  if (!match) return file;
  const dir = match[1] ?? '';
  const base = match[2] ?? file;
  // Keep the last two path segments to preserve context.
  const segments = dir.split(/[\\/]/).filter(Boolean);
  if (segments.length <= 2) return `${dir}${base}`;
  return `…/${segments.slice(-2).join('/')}/${base}`;
}

/**
 * Test-only: convert a raw frame-string array into the sanitized form.
 * Not used at runtime; exported for unit tests.
 */
export function sanitizeStackLine(line: string): string | undefined {
  const m = FRAME_LINE_RE.exec(line.trim());
  if (!m) return undefined;
  return m[1] ?? undefined;
}
