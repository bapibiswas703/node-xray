import { describe, it, expect } from 'vitest';
import { captureStack, sanitizeStackLine } from './stack.js';

describe('captureStack', () => {
  it('returns an array of sanitized frames for a sampled call', () => {
    const frames = captureStack({ rate: 1, maxFrames: 5 }, 1);
    expect(Array.isArray(frames)).toBe(true);
    if (frames) {
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.length).toBeLessThanOrEqual(5);
    }
  });

  it('returns undefined when rate is 0', () => {
    expect(captureStack({ rate: 0, maxFrames: 20 }, 1)).toBeUndefined();
  });

  it('truncates to maxFrames', () => {
    const frames = captureStack({ rate: 1, maxFrames: 1 }, 1);
    expect(frames?.length).toBe(1);
  });

  it('rewrites absolute file paths to short forms', () => {
    const frames = captureStack({ rate: 1, maxFrames: 20 }, 1);
    expect(frames).toBeDefined();
    for (const frame of frames ?? []) {
      // Should not leak a Windows absolute path.
      expect(frame).not.toMatch(/^[A-Z]:\\/);
    }
  });
});

describe('sanitizeStackLine', () => {
  it('extracts the file path from a standard V8 frame', () => {
    const line = '    at Object.<anonymous> (/foo/bar/baz/qux.ts:10:20)';
    expect(sanitizeStackLine(line)).toBe('/foo/bar/baz/qux.ts');
  });

  it('returns undefined for a non-frame line', () => {
    expect(sanitizeStackLine('Error: boom')).toBeUndefined();
  });
});
