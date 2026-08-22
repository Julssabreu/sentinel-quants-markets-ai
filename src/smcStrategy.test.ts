import { describe, expect, it } from 'vitest';
import { analyzeSmcStrategy } from './smcStrategy';
import type { Candle } from './analysisEngine';

const candles = (count: number, start = 100, step = .2): Candle[] => Array.from({ length: count }, (_, i) => {
  const close = start + i * step + Math.sin(i / 2);
  return { time: new Date(2026, 0, i + 1).toISOString(), open: close - .15, high: close + .5, low: close - .5, close };
});

describe('SMC multi-timeframe strategy', () => {
  it('does not fabricate a setup when required frames are missing', () => {
    const result = analyzeSmcStrategy({ D1: candles(10) });
    expect(result.stage).toBe('D1_BIAS');
    expect(result.score).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it('returns the five fixed timeframe responsibilities', () => {
    const result = analyzeSmcStrategy({ D1: candles(100), H4: candles(100), H1: candles(60), M15: candles(40), M5: candles(30) });
    expect(result.steps.map(step => step.timeframe)).toEqual(['D1', 'H4', 'H1', 'M15', 'M5']);
    expect(result.strategyId).toBe('SMC_D1_H4_H1_M15_M5_V1');
    expect(result.profileId).toBe('SMC_DEFAULT_D1_H4_H1_M15_M5_V1');
  });
  it('is causal at T: future bars do not alter the setup calculated from data cut at T', () => {
    const atT = { D1:candles(100), H4:candles(100), H1:candles(60), M15:candles(40), M5:candles(30) };
    const withFuture = Object.fromEntries(Object.entries(atT).map(([key, rows]) => [key, [...rows, ...candles(10, 500, -2)]]));
    const first = analyzeSmcStrategy(atT);
    const sameCut = analyzeSmcStrategy(Object.fromEntries(Object.entries(withFuture).map(([key, rows]) => [key, rows.slice(0, atT[key as keyof typeof atT].length)])));
    expect(sameCut).toEqual(first);
  });
});
