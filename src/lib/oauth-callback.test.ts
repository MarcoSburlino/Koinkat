import { describe, expect, it } from 'vitest';
import { parseAuthCallback } from './oauth-callback';

describe('OAuth callback app isolation', () => {
  const target = 'koinkat-demo://auth-callback';
  it('accepts the exact Demo target and preserves state', () => {
    expect(parseAuthCallback(`${target}?code=a%2Bb&state=s%26x`, target))
      .toEqual({ code: 'a+b', state: 's&x' });
  });
  it.each([
    'koinkat://auth-callback?code=a&state=s',
    'koinkat-demo://auth-callback.evil?code=a&state=s',
    'koinkat-demo://auth-callback/extra?code=a&state=s',
    'koinkat-demo://user@auth-callback?code=a&state=s',
    'koinkat-demo://auth-callback?code=a&code=b&state=s',
    'koinkat-demo://auth-callback?code=a&state=s&state=t',
    'koinkat-demo://auth-callback?code=a&state=s#fragment',
    'koinkat-demo://auth-callback?state=s',
    'not a url',
  ])('ignores foreign or ambiguous callbacks: %s', (value) => {
    expect(parseAuthCallback(value, target)).toBeNull();
  });
});
