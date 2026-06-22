/**
 * Re-export the public error classes from `@node-xray/types` so consumers
 * can import everything from `@node-xray/core`.
 */
export {
  XRayError,
  XRayNoContextError,
  XRayConfigError,
  XRayWireError,
  XRayStoreFullError,
} from '@node-xray/types';
