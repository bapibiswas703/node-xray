import { describe, it, expect } from 'vitest';
import {
  VERSION,
  WIRE_VERSION,
  XRayError,
  XRayNoContextError,
  XRayConfigError,
  XRayWireError,
  XRayStoreFullError,
} from './index.js';
import type { XRayOptions, RequestRecord, WireFrame } from './index.js';

describe('@node-xray/types', () => {
  it('exports a version string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exports a wire protocol version', () => {
    expect(WIRE_VERSION).toBe(1);
  });

  describe('error hierarchy', () => {
    it('XRayError has a stable code', () => {
      const err = new XRayError('boom', 'XRAY_TEST');
      expect(err.code).toBe('XRAY_TEST');
      expect(err.message).toBe('boom');
      expect(err).toBeInstanceOf(Error);
    });

    it('XRayNoContextError carries the standard code', () => {
      const err = new XRayNoContextError();
      expect(err.code).toBe('XRAY_NO_CONTEXT');
      expect(err).toBeInstanceOf(XRayError);
    });

    it('XRayConfigError carries the standard code', () => {
      const err = new XRayConfigError('bad config');
      expect(err.code).toBe('XRAY_CONFIG');
      expect(err.message).toBe('bad config');
    });

    it('XRayWireError carries the standard code', () => {
      const err = new XRayWireError('bad frame');
      expect(err.code).toBe('XRAY_WIRE');
    });

    it('XRayStoreFullError carries the standard code', () => {
      const err = new XRayStoreFullError();
      expect(err.code).toBe('XRAY_STORE_FULL');
    });

    it('subclass instanceof works after transpilation', () => {
      const err = new XRayNoContextError();
      expect(err).toBeInstanceOf(XRayNoContextError);
      expect(err).toBeInstanceOf(XRayError);
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('type contracts', () => {
    it('XRayOptions is structural', () => {
      const opts: XRayOptions = {
        enabled: true,
        path: '/debug',
        captureRequestBody: true,
        maxBodySize: 1000,
      };
      expect(opts.enabled).toBe(true);
    });

    it('RequestRecord is structural', () => {
      const rec: RequestRecord = {
        id: 'req_1',
        method: 'get',
        path: '/api/users',
        status: 200,
        startedAt: Date.now(),
        durationMs: 12,
        timeline: [],
        asyncOps: [],
        request: { headers: {} },
        response: { headers: {} },
        framework: 'express',
        tags: {},
      };
      expect(rec.method).toBe('get');
    });

    it('WireFrame is a discriminated union', () => {
      const frame: WireFrame = {
        v: 1,
        t: 'loop',
        payload: {
          lagMs: 0,
          p50: 0,
          p99: 0,
          max: 0,
          utilization: 0,
          phase: 'poll',
          sampledAt: 0,
        },
      };
      expect(frame.t).toBe('loop');
    });
  });
});
