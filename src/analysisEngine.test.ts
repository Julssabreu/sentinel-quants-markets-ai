import { describe, expect, it } from 'vitest';
import { analyzeCandles, atr, ema, macd, rsi, stochRsi } from './analysisEngine';

const candles = (direction: 1 | -1, count = 120) => Array.from({ length: count }, (_, index) => {
  const close = 100 + direction * index * 0.25 + Math.sin(index / 4) * 0.08;
  return { time: new Date(2026, 0, 1, index).toISOString(), open: close - direction * 0.1, high: close + 0.3, low: close - 0.3, close };
});

describe('technical analysis engine', () => {
  it('calculates stable reference indicators', () => {
    const values = Array.from({ length: 60 }, (_, index) => index + 1);
    expect(ema(values, 20)).toBeGreaterThan(49);
    expect(rsi(values)).toBe(100);
    expect(atr(candles(1), 14)).toBeCloseTo(0.6, 5);
    const closes=candles(1).map(x=>x.close),m=macd(closes),s=stochRsi(closes);
    expect(Number.isFinite(m.macd)).toBe(true);expect(m.histogram).toBeCloseTo(m.macd-m.signal,10);
    expect(s.k).toBeGreaterThanOrEqual(0);expect(s.k).toBeLessThanOrEqual(100);
  });

  it('detects opposing trend regimes without claiming certainty', () => {
    const bullish = analyzeCandles(candles(1));
    const bearish = analyzeCandles(candles(-1));
    expect(bullish.regime).toBe('ALCISTA');
    expect(bearish.regime).toBe('BAJISTA');
    expect(bullish.confidence).toBeLessThanOrEqual(85);
    expect(bearish.confidence).toBeLessThanOrEqual(85);
  });

  it('refuses analysis with insufficient data', () => {
    expect(analyzeCandles(candles(1, 20)).regime).toBe('DATOS_INSUFICIENTES');
  });
});
