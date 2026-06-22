/**
 * @node-xray/dashboard
 *
 * Ships the dashboard UI as static assets (`index.html`, `app.js`,
 * `styles.css`) and a tiny barrel that the core uses to resolve their
 * on-disk location at runtime.
 *
 * The package is intentionally small: no runtime JavaScript, no build
 * step, and no third-party dependencies. Adapters call
 * `getAssetsDir()` to discover where the assets live after the package
 * is installed.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Bump on any breaking change to the wire protocol or asset layout. */
export const DASHBOARD_VERSION = '1.0.0' as const;

/**
 * Resolve the absolute path to the dashboard assets directory. The
 * directory contains `index.html`, `app.js`, and `styles.css` and is
 * shipped as-is (no transpile, no bundler).
 *
 * In the published package layout the assets live alongside the
 * `dist/` directory, i.e. `<package>/assets/`. In a workspace / dev
 * layout where the build has not been run, the assets are still
 * present at `<package>/assets/` because they live in source control.
 */
export function getAssetsDir(): string {
  // `import.meta.url` resolves to `<pkg>/dist/index.js` (ESM) or
  // `<pkg>/dist/index.cjs` (CJS, via createRequire); in both cases the
  // assets directory is one level up from `dist/`.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'assets');
}

/** Resolve a single asset by name, e.g. `getAssetPath('app.js')`. */
export function getAssetPath(name: string): string {
  return join(getAssetsDir(), name);
}

/**
 * Inline a small `<script>` that sets the dashboard's path on
 * `window.__XRAY_DASHBOARD_PATH__` before the main `app.js` loads.
 * The core injects this into `index.html` so the same bundle works
 * regardless of the configured path.
 */
export const PATH_INJECTOR_SCRIPT = `window.__XRAY_DASHBOARD_PATH__ = '__PATH__';`;
