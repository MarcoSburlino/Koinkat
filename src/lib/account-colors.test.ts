import { describe, it, expect } from 'vitest';
import { distinctAccountColors } from './account-colors';

describe('distinctAccountColors', () => {
  it('keeps unique colours untouched', () => {
    expect(distinctAccountColors(['#2563eb', '#16a34a'])).toEqual(['#2563eb', '#16a34a']);
  });

  it('gives repeated colours the next validated slot, first one keeps its own', () => {
    expect(distinctAccountColors(['#2563eb', '#2563EB', '#2563eb'])).toEqual([
      '#2563eb',
      'var(--viz-1)',
      'var(--viz-2)',
    ]);
  });

  it('treats an empty colour as needing a slot', () => {
    expect(distinctAccountColors(['', '#16a34a'])).toEqual(['var(--viz-1)', '#16a34a']);
  });

  it('falls back to Other after the six slots', () => {
    const out = distinctAccountColors(Array.from({ length: 8 }, () => '#000000'));
    expect(out[7]).toBe('var(--viz-other)');
  });
});
