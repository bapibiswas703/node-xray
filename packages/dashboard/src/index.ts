/**
 * @node-xray/dashboard
 *
 * Static assets and WebSocket server factory. The assets are
 * extracted from `docs/node_xray_dashboard_v4_1 - Copy.html` and
 * shipped as separate CSS / JS files in P5.
 *
 * P0 stub: re-exports a no-op factory so adapters can import it.
 */

export const DASHBOARD_VERSION = '0.1.0' as const;

export function dashboardAssetsPath(): string {
  // P0 placeholder. P5 will resolve to the bundled `assets/` directory.
  return 'assets/';
}
