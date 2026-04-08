import { test, expect, describe } from 'bun:test';
import { calculateCost, getModelRate, PRICING } from '../services/pricing.ts';

describe('pricing', () => {
  test('calculates cost for claude-opus-4-6', () => {
    const cost = calculateCost('claude-opus-4-6', 1_000_000, 100_000);
    // 1M * 15 / 1M + 100K * 75 / 1M = 15 + 7.5 = 22.5
    expect(cost).toBeCloseTo(22.5, 2);
  });

  test('calculates cost for gpt-5.4', () => {
    const cost = calculateCost('gpt-5.4', 1_000_000, 1_000_000);
    // 1M * 2.5 / 1M + 1M * 10 / 1M = 2.5 + 10 = 12.5
    expect(cost).toBeCloseTo(12.5, 2);
  });

  test('uses default pricing for unknown model', () => {
    const cost = calculateCost('unknown-model-xyz', 1_000_000, 1_000_000);
    // 1M * 1.0 / 1M + 1M * 5.0 / 1M = 1 + 5 = 6
    expect(cost).toBeCloseTo(6.0, 2);
  });

  test('returns zero cost for zero tokens', () => {
    expect(calculateCost('claude-opus-4-6', 0, 0)).toBe(0);
  });

  test('handles real-world token counts', () => {
    // alice's first request: 50K in, 2K out on opus
    const cost = calculateCost('claude-opus-4-6', 50000, 2000);
    // 50K * 15 / 1M + 2K * 75 / 1M = 0.75 + 0.15 = 0.9
    expect(cost).toBeCloseTo(0.9, 2);
  });

  test('getModelRate returns known model rates', () => {
    const rate = getModelRate('claude-haiku-4-5-20251001');
    expect(rate.input).toBe(0.80);
    expect(rate.output).toBe(4.0);
  });

  test('getModelRate returns default for unknown model', () => {
    const rate = getModelRate('nonexistent');
    expect(rate.input).toBe(1.0);
    expect(rate.output).toBe(5.0);
  });

  test('all pricing entries have positive rates', () => {
    for (const [model, rates] of Object.entries(PRICING)) {
      expect(rates.input).toBeGreaterThan(0);
      expect(rates.output).toBeGreaterThan(0);
    }
  });
});
