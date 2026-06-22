import { describe, it, expect } from 'vitest';
import { VERSION } from './index.js';

describe('@node-xray/types', () => {
  it('exports a version string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
