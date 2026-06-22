import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveOptions } from './config.js';

const ORIGINAL_ENV = process.env['NODE_ENV'];

beforeEach(() => {
  delete process.env['NODE_ENV'];
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env['NODE_ENV'];
  else process.env['NODE_ENV'] = ORIGINAL_ENV;
});

describe('resolveOptions', () => {
  it('applies defaults in development', () => {
    const r = resolveOptions();
    expect(r.enabled).toBe(true);
    expect(r.path).toBe('/node-xray');
    expect(r.captureRequestBody).toBe(true);
    expect(r.captureResponseBody).toBe(true);
    expect(r.maxBodySize).toBe(102_400);
    expect(r.maxRequests).toBe(200);
    expect(r.sampleRate).toBe(1);
    expect(r.redactHeaders.has('authorization')).toBe(true);
    expect(r.redactHeaders.has('cookie')).toBe(true);
    expect(r.redactBodyPaths).toContain('password');
    expect(r.stack.enabled).toBe(true);
    expect(r.stack.rate).toBe(0.1);
    expect(r.stack.maxFrames).toBe(20);
    expect(r.websocket.enabled).toBe(true);
    expect(r.websocket.maxClients).toBe(4);
  });

  it('disables by default in production', () => {
    process.env['NODE_ENV'] = 'production';
    const r = resolveOptions();
    expect(r.enabled).toBe(false);
    expect(r.captureRequestBody).toBe(false);
    expect(r.captureResponseBody).toBe(false);
  });

  it('throws if production is enabled without auth', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => resolveOptions({ enabled: true })).toThrow(/auth is required/);
  });

  it('accepts production with auth', () => {
    process.env['NODE_ENV'] = 'production';
    const r = resolveOptions({
      enabled: true,
      auth: { type: 'bearer', token: 'secret' },
    });
    expect(r.enabled).toBe(true);
    expect(r.auth).toEqual({ type: 'bearer', token: 'secret' });
  });

  it('merges user redact headers with the default deny list', () => {
    const r = resolveOptions({ redactHeaders: ['X-Internal-Token'] });
    expect(r.redactHeaders.has('authorization')).toBe(true);
    expect(r.redactHeaders.has('x-internal-token')).toBe(true);
  });

  it('lowercases header names for case-insensitive matching', () => {
    const r = resolveOptions({ redactHeaders: ['X-CUSTOM'] });
    expect(r.redactHeaders.has('x-custom')).toBe(true);
  });

  it('merges user redact body paths with the defaults', () => {
    const r = resolveOptions({ redactBodyPaths: ['*.ssn'] });
    expect(r.redactBodyPaths).toContain('password');
    expect(r.redactBodyPaths).toContain('*.ssn');
  });

  it('clamps sampleRate to [0, 1]', () => {
    expect(resolveOptions({ sampleRate: 2 }).sampleRate).toBe(1);
    expect(resolveOptions({ sampleRate: -1 }).sampleRate).toBe(0);
    expect(resolveOptions({ sampleRate: NaN }).sampleRate).toBe(0);
    expect(resolveOptions({ sampleRate: 0.5 }).sampleRate).toBe(0.5);
  });

  it('clamps stack rate to [0, 1]', () => {
    expect(resolveOptions({ stack: { rate: 5 } }).stack.rate).toBe(1);
    expect(resolveOptions({ stack: { rate: -1 } }).stack.rate).toBe(0);
  });

  it('floors stack maxFrames to >= 1', () => {
    expect(resolveOptions({ stack: { maxFrames: 0 } }).stack.maxFrames).toBe(1);
    expect(resolveOptions({ stack: { maxFrames: 50.7 } }).stack.maxFrames).toBe(50);
  });

  it('floors maxClients to >= 1', () => {
    expect(resolveOptions({ websocket: { maxClients: 0 } }).websocket.maxClients).toBe(1);
  });

  it('rejects paths that do not start with /', () => {
    expect(() => resolveOptions({}, 'node-xray')).toThrow(/must start with/);
  });

  it('rejects paths containing ..', () => {
    expect(() => resolveOptions({}, '/foo/../bar')).toThrow(/must not contain/);
  });

  it('rejects paths longer than 256 characters', () => {
    const long = '/' + 'a'.repeat(256);
    expect(() => resolveOptions({}, long)).toThrow(/at most 256/);
  });

  it('passes through a custom onError', () => {
    const onError = () => {};
    const r = resolveOptions({ onError });
    expect(r.onError).toBe(onError);
  });

  it('passes through a custom ignore predicate', () => {
    const ignore = () => true;
    const r = resolveOptions({ ignore });
    expect(r.ignore).toBe(ignore);
  });
});
