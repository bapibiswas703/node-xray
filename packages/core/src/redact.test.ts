import { describe, it, expect } from 'vitest';
import { redactHeaders, redactBody, truncateBody, redactSnapshot } from './redact.js';

describe('redactHeaders', () => {
  it('replaces denied header values with [REDACTED]', () => {
    const out = redactHeaders(
      { authorization: 'Bearer xyz', cookie: 'sid=abc', 'x-keep': 'ok' },
      new Set(['authorization', 'cookie']),
    );
    expect(out).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'x-keep': 'ok',
    });
  });

  it('matches header names case-insensitively', () => {
    const out = redactHeaders({ Authorization: 'Bearer xyz' }, new Set(['authorization']));
    expect(out).toEqual({ Authorization: '[REDACTED]' });
  });

  it('joins array values with ", "', () => {
    const out = redactHeaders({ 'x-foo': ['a', 'b'] }, new Set());
    expect(out).toEqual({ 'x-foo': 'a, b' });
  });

  it('emits empty string for undefined values', () => {
    const out = redactHeaders({ 'x-foo': undefined }, new Set());
    expect(out).toEqual({ 'x-foo': '' });
  });

  it('does not mutate the input', () => {
    const input = { authorization: 'Bearer xyz' };
    redactHeaders(input, new Set(['authorization']));
    expect(input.authorization).toBe('Bearer xyz');
  });
});

describe('redactBody', () => {
  it('redacts top-level keys', () => {
    const out = redactBody({ password: 'p', username: 'u' }, ['password']);
    expect(out).toEqual({ password: '[REDACTED]', username: 'u' });
  });

  it('redacts nested keys with wildcard', () => {
    const out = redactBody({ user: { token: 't', name: 'n' } }, ['*.token']);
    expect(out).toEqual({ user: { token: '[REDACTED]', name: 'n' } });
  });

  it('redacts array elements', () => {
    const out = redactBody(
      {
        cards: [
          { cvv: '111', n: '1' },
          { cvv: '222', n: '2' },
        ],
      },
      ['cards[*].cvv'],
    );
    expect(out).toEqual({
      cards: [
        { cvv: '[REDACTED]', n: '1' },
        { cvv: '[REDACTED]', n: '2' },
      ],
    });
  });

  it('returns the input unchanged for empty paths', () => {
    const input = { password: 'p' };
    expect(redactBody(input, [])).toBe(input);
  });

  it('returns primitives unchanged', () => {
    expect(redactBody(42, ['x'])).toBe(42);
    expect(redactBody('hello', ['x'])).toBe('hello');
    expect(redactBody(null, ['x'])).toBe(null);
  });

  it('handles cycles without recursing forever', () => {
    const a: Record<string, unknown> = { password: 'p' };
    a['self'] = a;
    const out = redactBody(a, ['password']) as Record<string, unknown>;
    expect(out['password']).toBe('[REDACTED]');
    expect(out['self']).toBe('[CYCLE]');
  });

  it('caps recursion depth', () => {
    let deep: Record<string, unknown> = { password: 'p' };
    for (let i = 0; i < 30; i++) {
      deep = { nested: deep };
    }
    const out = redactBody(deep, ['password']);
    expect(JSON.stringify(out)).toContain('[DEPTH]');
  });

  it('does not mutate the input', () => {
    const input = { password: 'p', nested: { token: 't' } };
    redactBody(input, ['password', '*.token']);
    expect(input.password).toBe('p');
    expect((input.nested as { token: string }).token).toBe('t');
  });
});

describe('truncateBody', () => {
  it('returns the value unchanged when small enough', () => {
    const input = { ok: true };
    expect(truncateBody(input, 1000)).toBe(input);
  });

  it('replaces with a marker when too large', () => {
    const big = { data: 'x'.repeat(200) };
    const out = truncateBody(big, 50) as { __truncated: boolean; originalSize: number };
    expect(out.__truncated).toBe(true);
    expect(out.originalSize).toBeGreaterThan(50);
  });

  it('handles unserializable values', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const out = truncateBody(circular, 1000) as { reason: string };
    expect(out.reason).toBe('unserializable');
  });
});

describe('redactSnapshot', () => {
  it('redacts then truncates', () => {
    const input = { password: 'p', ok: true };
    const out = redactSnapshot(input, ['password'], 1000);
    expect(out).toEqual({ password: '[REDACTED]', ok: true });
  });

  it('truncates after redaction if the redacted form is still too large', () => {
    // `data` is not a redacted field, so the redacted form retains it.
    // Setting a tiny maxBytes forces truncation.
    const input = { data: 'x'.repeat(200), password: 'p' };
    const out = redactSnapshot(input, ['password'], 20) as { __truncated: boolean };
    expect(out.__truncated).toBe(true);
  });
});
